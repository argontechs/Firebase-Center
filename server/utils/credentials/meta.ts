import type { appCredentials } from '~~/server/db/schema';
import { fingerprint } from '~~/server/utils/crypto';
import { isReady } from '~~/server/utils/credentials/readiness';

type Row = typeof appCredentials.$inferSelect;

export interface CredentialMeta {
  id: string;
  appId: string;
  provider: 'fcm' | 'huawei';
  platform: 'ios' | 'android' | 'huawei' | 'web' | 'any';
  label: string | null;
  configured: true;
  projectId: string | null;
  huaweiAppId: string | null;
  fingerprint: string;
  ready: boolean;
  configuredAt: string;
  rotatedAt: string | null;
}

// Projects a row to metadata only. NEVER includes ciphertext/nonce/tag or the decrypted secret.
// `secretPlaintext` is passed only to compute the display fingerprint, then discarded.
export function toCredentialMeta(row: Row, secretPlaintext: string): CredentialMeta {
  const meta = (row.metaJsonb ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    appId: row.appId,
    provider: row.provider,
    platform: row.platform,
    label: row.label,
    configured: true,
    projectId: (meta.project_id as string) ?? (meta.huawei_project_id as string) ?? null,
    huaweiAppId: (meta.app_id as string) ?? null,
    fingerprint: fingerprint(secretPlaintext),
    ready: isReady(row),
    configuredAt: row.configuredAt.toISOString(),
    rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
  };
}
