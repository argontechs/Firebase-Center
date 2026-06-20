import { parse as parseCsvSync } from 'csv-parse/sync';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { companies, apps, appCredentials } from '~~/server/db/schema';
import { encryptSecret } from '~~/server/utils/crypto';
import { audit } from '~~/server/utils/audit';

export interface CredentialManifestRow {
  rowNumber: number;              // 1-based source row (header = row 0)
  company: string | null;
  app: string | null;
  provider: string | null;       // 'fcm' | 'huawei'
  platform: string | null;       // 'ios' | 'android' | 'huawei' | 'web' | 'any'
  label: string | null;
  saJsonFile: string | null;     // FCM: filename of an uploaded .json
  projectId: string | null;      // FCM optional override
  appId: string | null;          // Huawei app_id
  appSecret: string | null;      // Huawei app_secret
  huaweiProjectId: string | null;// Huawei optional v2 project id
}

export type CredImportReason =
  | 'COMPANY_MISSING' | 'APP_MISSING' | 'PROVIDER_UNRECOGNIZED' | 'PLATFORM_INCONSISTENT'
  | 'SA_FILE_MISSING' | 'SA_JSON_INVALID' | 'HUAWEI_FIELDS_MISSING';

export interface CredImportError { rowNumber: number; reason: CredImportReason; }
export interface CredImportResult { created: number; updated: number; failed: number; errors: CredImportError[]; }

type Provider = 'fcm' | 'huawei';
type CredPlatform = 'ios' | 'android' | 'huawei' | 'web' | 'any';

const PROVIDERS = new Set<Provider>(['fcm', 'huawei']);
const FCM_PLATFORMS = new Set<CredPlatform>(['ios', 'android', 'web']);

function cell(record: Record<string, unknown>, col: string): string | null {
  const v = record[col];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function parseCredentialManifest(csv: string): CredentialManifestRow[] {
  const records: Record<string, unknown>[] = parseCsvSync(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records.map((r, i) => ({
    rowNumber: i + 1,
    company: cell(r, 'company'),
    app: cell(r, 'app'),
    provider: cell(r, 'provider'),
    platform: cell(r, 'platform'),
    label: cell(r, 'label'),
    saJsonFile: cell(r, 'sa_json_file'),
    projectId: cell(r, 'project_id'),
    appId: cell(r, 'app_id'),
    appSecret: cell(r, 'app_secret'),
    huaweiProjectId: cell(r, 'huawei_project_id'),
  }));
}

interface RowPlan {
  secret: string;
  provider: Provider;
  platform: CredPlatform;
  meta: Record<string, unknown>;
}

function planRow(
  row: CredentialManifestRow,
  files: Record<string, string>,
): RowPlan | { error: CredImportReason } {
  if (!row.company) return { error: 'COMPANY_MISSING' };
  if (!row.app) return { error: 'APP_MISSING' };
  if (!row.provider || !PROVIDERS.has(row.provider as Provider)) {
    return { error: 'PROVIDER_UNRECOGNIZED' };
  }

  const provider = row.provider as Provider;
  const platform = (row.platform ?? '') as CredPlatform;

  // Platform consistency: huawei provider => huawei or any; fcm provider => ios/android/web
  const consistent = provider === 'huawei'
    ? (platform === 'huawei' || platform === 'any')
    : FCM_PLATFORMS.has(platform);
  if (!consistent) return { error: 'PLATFORM_INCONSISTENT' };

  if (provider === 'fcm') {
    if (!row.saJsonFile || !(row.saJsonFile in files)) return { error: 'SA_FILE_MISSING' };
    const text = files[row.saJsonFile];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: 'SA_JSON_INVALID' };
    }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return { error: 'SA_JSON_INVALID' };
    }
    return {
      secret: text,
      provider,
      platform,
      meta: {
        // Prefer manifest override; fall back to value from .json
        project_id: row.projectId ?? (parsed.project_id as string),
      },
    };
  }

  // provider === 'huawei'
  if (!row.appId || !row.appSecret) return { error: 'HUAWEI_FIELDS_MISSING' };
  const { appId, appSecret } = row;
  const projectId = row.huaweiProjectId ?? undefined;
  // Secret must be a JSON object so resolve.ts can JSON.parse it and the adapter can read
  // secret.appId / secret.appSecret (HuaweiSecret shape).
  const secret = JSON.stringify({
    appId,
    appSecret,
    ...(projectId ? { projectId } : {}),
  });
  // meta.project_id (canonical key, matching FCM branch) drives v2 URL selection in the adapter.
  // push_kit_enabled: true satisfies isReady() so the credential is immediately usable.
  const meta: Record<string, unknown> = {
    app_id: appId,
    push_kit_enabled: true,
    ...(projectId ? { project_id: projectId } : {}),
  };
  return { secret, provider, platform, meta };
}

// Atomic upsert: INSERT … ON CONFLICT (name) DO NOTHING … RETURNING handles concurrent
// imports without a select-then-insert race that could produce duplicate company rows.
// Requires UNIQUE constraint on companies.name (migration 0002).
async function upsertCompanyByName(name: string): Promise<string> {
  const inserted = await db
    .insert(companies)
    .values({ name })
    .onConflictDoNothing({ target: companies.name })
    .returning({ id: companies.id });
  if (inserted.length > 0) return inserted[0].id;
  // Row already existed — fetch it.
  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.name, name));
  return existing.id;
}

// Atomic upsert keyed by (company_id, name). Requires UNIQUE constraint on
// apps.(company_id, name) (migration 0002).
async function upsertAppByName(companyId: string, name: string): Promise<string> {
  const inserted = await db
    .insert(apps)
    .values({ companyId, name })
    .onConflictDoNothing({ target: [apps.companyId, apps.name] })
    .returning({ id: apps.id });
  if (inserted.length > 0) return inserted[0].id;
  // Row already existed — fetch it.
  const [existing] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.companyId, companyId), eq(apps.name, name)));
  return existing.id;
}

// Validates + upserts company→app→app_credentials for every manifest row.
// `files` maps an uploaded .json filename → its raw text.
// Bad rows are collected in `errors` and never written (no partial secrets).
export async function importCredentials(input: {
  userId: string | null;
  manifestCsv: string;
  files: Record<string, string>;
}): Promise<CredImportResult> {
  const rows = parseCredentialManifest(input.manifestCsv);
  const result: CredImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const row of rows) {
    const plan = planRow(row, input.files);
    if ('error' in plan) {
      result.failed += 1;
      result.errors.push({ rowNumber: row.rowNumber, reason: plan.error });
      continue;
    }

    const companyId = await upsertCompanyByName(row.company!);
    const appId = await upsertAppByName(companyId, row.app!);
    const enc = encryptSecret(plan.secret);

    // Upsert keyed by (app_id, provider, platform); on conflict re-encrypt with a fresh nonce.
    // xmax = 0 on a genuine INSERT, non-zero on an ON CONFLICT UPDATE (Postgres-specific).
    const inserted = await db
      .insert(appCredentials)
      .values({
        appId,
        provider: plan.provider,
        platform: plan.platform,
        label: row.label,
        secretCiphertext: enc.ciphertext,
        secretNonce: enc.nonce,
        secretTag: enc.tag,
        keyVersion: enc.keyVersion,
        metaJsonb: plan.meta,
      })
      .onConflictDoUpdate({
        target: [appCredentials.appId, appCredentials.provider, appCredentials.platform],
        set: {
          label: row.label,
          secretCiphertext: enc.ciphertext,
          secretNonce: enc.nonce,
          secretTag: enc.tag,
          keyVersion: enc.keyVersion,
          metaJsonb: plan.meta,
          rotatedAt: new Date(),
        },
      })
      .returning({
        id: appCredentials.id,
        isInsert: sql<boolean>`(xmax = 0)`,
      });

    const credId = inserted[0].id;
    const wasInserted = inserted[0].isInsert;

    if (wasInserted) {
      result.created += 1;
    } else {
      result.updated += 1;
    }

    await audit({
      userId: input.userId,
      action: 'credential_save',
      targetType: 'app_credential',
      targetId: credId,
      meta: {
        appId,
        provider: plan.provider,
        platform: plan.platform,
        source: 'import',
      },
    });
  }

  return result;
}
