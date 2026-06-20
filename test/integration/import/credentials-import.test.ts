import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~~/server/db/client';
import { appCredentials, apps, companies, users, auditLog } from '~~/server/db/schema';
import { decryptSecret } from '~~/server/utils/crypto';
import { parseCredentialManifest, importCredentials } from '~~/server/utils/import/credentials';
import { resolveCredential } from '~~/server/utils/credentials/resolve';
import { resetDb } from '~~/server/test/db';
import { and, eq } from 'drizzle-orm';

// Ensure the master key is set for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let userId = '';
const SA = JSON.stringify({ project_id: 'proj-1', client_email: 'x@y.iam', private_key: '-----BEGIN-----SA_SENTINEL-----END-----' });

beforeEach(async () => {
  await resetDb();
  const [u] = await db.insert(users).values({ email: 'op@x.io', passwordHash: 'h' }).returning();
  userId = u.id;
});

describe('parseCredentialManifest', () => {
  it('maps credential columns to 1-based rows (distinct from device-import columns)', () => {
    const csv = 'company,app,provider,platform,label,sa_json_file,project_id,app_id,app_secret,huawei_project_id\n'
      + 'Acme,Shopper,fcm,android,Android prod,acme.json,proj-1,,,\n'
      + 'Acme,Shopper,huawei,huawei,HW,,,10086,sek,hw-proj\n';
    const rows = parseCredentialManifest(csv);
    expect(rows).toEqual([
      { rowNumber: 1, company: 'Acme', app: 'Shopper', provider: 'fcm', platform: 'android', label: 'Android prod',
        saJsonFile: 'acme.json', projectId: 'proj-1', appId: null, appSecret: null, huaweiProjectId: null },
      { rowNumber: 2, company: 'Acme', app: 'Shopper', provider: 'huawei', platform: 'huawei', label: 'HW',
        saJsonFile: null, projectId: null, appId: '10086', appSecret: 'sek', huaweiProjectId: 'hw-proj' },
    ]);
  });
});

describe('importCredentials', () => {
  it('upserts Company by name, App by (company,name), and encrypts the FCM .json as the secret', async () => {
    const csv = 'company,app,provider,platform,label,sa_json_file,project_id\nAcme,Shopper,fcm,android,prod,acme.json,\n';
    const res = await importCredentials({ userId, manifestCsv: csv, files: { 'acme.json': SA } });
    expect(res).toMatchObject({ created: 1, updated: 0, failed: 0, errors: [] });

    const [company] = await db.select().from(companies).where(eq(companies.name, 'Acme'));
    const [app] = await db.select().from(apps).where(and(eq(apps.companyId, company.id), eq(apps.name, 'Shopper')));
    const [cred] = await db.select().from(appCredentials).where(eq(appCredentials.appId, app.id));
    expect(cred.provider).toBe('fcm');
    expect(cred.platform).toBe('android');
    expect((cred.metaJsonb as any).project_id).toBe('proj-1');   // read from the .json when manifest omits it
    expect(cred.secretCiphertext).not.toContain('SA_SENTINEL');
    expect(decryptSecret({ ciphertext: cred.secretCiphertext, nonce: cred.secretNonce, tag: cred.secretTag, keyVersion: cred.keyVersion })).toBe(SA);
  });

  it('encrypts the Huawei credentials as a JSON object and stores canonical meta keys so the credential is ready', async () => {
    const csv = 'company,app,provider,platform,label,app_id,app_secret,huawei_project_id\nGlobex,Main,huawei,huawei,HW,10086,sek-xyz,hw-proj\n';
    const res = await importCredentials({ userId, manifestCsv: csv, files: {} });
    expect(res).toMatchObject({ created: 1, failed: 0 });
    const [cred] = await db.select().from(appCredentials);
    // meta must use the canonical keys the adapter and isReady() depend on
    expect((cred.metaJsonb as any).app_id).toBe('10086');
    expect((cred.metaJsonb as any).project_id).toBe('hw-proj');      // canonical key for v2 URL selection
    expect((cred.metaJsonb as any).push_kit_enabled).toBe(true);     // required by isReady()
    expect((cred.metaJsonb as any).huawei_project_id).toBeUndefined(); // wrong legacy key must be absent
    // secret must be a JSON object (HuaweiSecret shape) so resolve.ts JSON.parse succeeds
    expect(cred.secretCiphertext).not.toContain('sek-xyz');
    const plaintext = decryptSecret({ ciphertext: cred.secretCiphertext, nonce: cred.secretNonce, tag: cred.secretTag, keyVersion: cred.keyVersion });
    const secret = JSON.parse(plaintext);
    expect(secret.appId).toBe('10086');
    expect(secret.appSecret).toBe('sek-xyz');
    expect(secret.projectId).toBe('hw-proj');
  });

  it('re-running the same manifest UPDATES the credential keyed by (app_id, provider, platform)', async () => {
    const csv = 'company,app,provider,platform,sa_json_file\nAcme,Shopper,fcm,android,acme.json\n';
    await importCredentials({ userId, manifestCsv: csv, files: { 'acme.json': SA } });
    const SA2 = JSON.stringify({ project_id: 'proj-1', client_email: 'x@y.iam', private_key: '-----BEGIN-----SA_ROTATED-----END-----' });
    const res = await importCredentials({ userId, manifestCsv: csv, files: { 'acme.json': SA2 } });
    expect(res).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const rows = await db.select().from(appCredentials);
    expect(rows).toHaveLength(1);
    expect(decryptSecret({ ciphertext: rows[0].secretCiphertext, nonce: rows[0].secretNonce, tag: rows[0].secretTag, keyVersion: rows[0].keyVersion })).toBe(SA2);
  });

  it('rejects bad rows (missing .json, invalid JSON, huawei fields missing, inconsistent platform) with NO partial writes', async () => {
    const csv = 'company,app,provider,platform,sa_json_file,app_id,app_secret\n'
      + 'Acme,Shopper,fcm,android,absent.json,,\n'        // SA_FILE_MISSING
      + 'Acme,Shopper,fcm,ios,bad.json,,\n'               // SA_JSON_INVALID (parses but no project_id/client_email/private_key)
      + 'Acme,Shopper,huawei,huawei,,,\n'                 // HUAWEI_FIELDS_MISSING
      + 'Acme,Shopper,huawei,android,,10086,sek\n';      // PLATFORM_INCONSISTENT
    const res = await importCredentials({ userId, manifestCsv: csv, files: { 'bad.json': '{"foo":"bar"}' } });
    expect(res.created).toBe(0);
    expect(res.failed).toBe(4);
    expect(res.errors).toEqual([
      { rowNumber: 1, reason: 'SA_FILE_MISSING' },
      { rowNumber: 2, reason: 'SA_JSON_INVALID' },
      { rowNumber: 3, reason: 'HUAWEI_FIELDS_MISSING' },
      { rowNumber: 4, reason: 'PLATFORM_INCONSISTENT' },
    ]);
    expect(await db.select().from(appCredentials)).toHaveLength(0);   // never write a partial secret
  });

  it('audits each created/updated credential with credential_save and never logs the secret', async () => {
    const csv = 'company,app,provider,platform,sa_json_file\nAcme,Shopper,fcm,android,acme.json\n';
    const res = await importCredentials({ userId, manifestCsv: csv, files: { 'acme.json': SA } });
    const [cred] = await db.select().from(appCredentials);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential_save'));
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(cred.id);
    expect(JSON.stringify(audits)).not.toContain('SA_SENTINEL');
    expect(res.created).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F3 regression: import → resolveCredential round-trip for Huawei
// ---------------------------------------------------------------------------
describe('Huawei import → resolveCredential (F3)', () => {
  it('imported Huawei credential is ready===true, secret round-trips as object, and v2 URL is selected when project id given', async () => {
    // Import a Huawei credential with a project id (v2 scenario).
    const csv = 'company,app,provider,platform,label,app_id,app_secret,huawei_project_id\n'
      + 'CorpX,PushApp,huawei,huawei,Huawei prod,88888,secret-abc,proj-v2\n';
    const res = await importCredentials({ userId, manifestCsv: csv, files: {} });
    expect(res).toMatchObject({ created: 1, failed: 0 });

    // Locate the app that was created by the import.
    const [company] = await db.select().from(companies).where(eq(companies.name, 'CorpX'));
    const [app] = await db.select().from(apps).where(and(eq(apps.companyId, company.id), eq(apps.name, 'PushApp')));

    // resolveCredential must return ready: true (not NOT_READY) because push_kit_enabled is set.
    const resolved = await resolveCredential(app.id, 'huawei', 'huawei');
    expect(resolved.ready).toBe(true);
    if (!resolved.ready) throw new Error('Expected ready credential');

    const { credential } = resolved;

    // Secret must be a parsed object with the HuaweiSecret shape.
    const secret = credential.secret as { appId: string; appSecret: string; projectId?: string };
    expect(secret.appId).toBe('88888');
    expect(secret.appSecret).toBe('secret-abc');
    expect(secret.projectId).toBe('proj-v2');

    // meta.project_id (canonical key) must be present so the adapter selects the v2 send URL.
    const meta = credential.meta as { app_id: string; project_id?: string; push_kit_enabled: boolean };
    expect(meta.project_id).toBe('proj-v2');
    expect(meta.push_kit_enabled).toBe(true);
  });

  it('imported Huawei credential without project id is ready===true and uses v1 (no project_id in meta)', async () => {
    const csv = 'company,app,provider,platform,label,app_id,app_secret,huawei_project_id\n'
      + 'CorpY,PushApp2,huawei,huawei,Huawei v1,77777,secret-v1,\n';
    const res = await importCredentials({ userId, manifestCsv: csv, files: {} });
    expect(res).toMatchObject({ created: 1, failed: 0 });

    const [company] = await db.select().from(companies).where(eq(companies.name, 'CorpY'));
    const [app] = await db.select().from(apps).where(and(eq(apps.companyId, company.id), eq(apps.name, 'PushApp2')));

    const resolved = await resolveCredential(app.id, 'huawei', 'huawei');
    expect(resolved.ready).toBe(true);
    if (!resolved.ready) throw new Error('Expected ready credential');

    const secret = resolved.credential.secret as { appId: string; appSecret: string; projectId?: string };
    expect(secret.appId).toBe('77777');
    expect(secret.appSecret).toBe('secret-v1');
    expect(secret.projectId).toBeUndefined(); // no projectId in v1 case

    // meta must NOT have project_id so the adapter falls back to v1 URL
    const meta = resolved.credential.meta as { app_id: string; project_id?: string; push_kit_enabled: boolean };
    expect(meta.project_id).toBeUndefined();
    expect(meta.push_kit_enabled).toBe(true);
  });
});
