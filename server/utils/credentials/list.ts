import { db } from '~~/server/db/client';
import { appCredentials } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import type { CredentialMeta } from '~~/server/utils/credentials/meta';
import { isReady } from '~~/server/utils/credentials/readiness';

export type CredentialListMeta = Omit<CredentialMeta, 'fingerprint'>;

// Read path: project rows to metadata only. The decrypted secret is NEVER touched here,
// so there is no fingerprint (fingerprint is returned only on save/rotate when plaintext is in hand).
export async function listCredentials(appId: string): Promise<CredentialListMeta[]> {
  const rows = await db.select().from(appCredentials).where(eq(appCredentials.appId, appId));
  return rows.map((row) => {
    const meta = (row.metaJsonb ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      appId: row.appId,
      provider: row.provider,
      platform: row.platform,
      label: row.label,
      configured: true as const,
      projectId: (meta.project_id as string) ?? (meta.huawei_project_id as string) ?? null,
      huaweiAppId: (meta.app_id as string) ?? null,
      ready: isReady(row),
      configuredAt: row.configuredAt.toISOString(),
      rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
    };
  });
}
