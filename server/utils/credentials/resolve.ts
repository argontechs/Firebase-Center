import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { appCredentials } from '~~/server/db/schema';
import { decryptSecret } from '~~/server/utils/crypto';
import type { Provider, DevicePlatform, ResolvedCredential } from '~~/server/utils/push/types';

type CredRow = typeof appCredentials.$inferSelect;

// Single readiness source of truth — reads the SAME meta_jsonb flag keys M3's save path writes.
// FCM ios -> apns_p8_uploaded; FCM web -> vapid_present; FCM android/any -> ready once configured.
// Huawei (any platform) -> push_kit_enabled.
export function isReady(credentialRow: CredRow): boolean {
  const meta = (credentialRow.metaJsonb ?? {}) as Record<string, unknown>;
  if (credentialRow.provider === 'huawei') {
    return meta.push_kit_enabled === true;
  }
  // provider === 'fcm'
  switch (credentialRow.platform) {
    case 'ios':     return meta.apns_p8_uploaded === true;
    case 'web':     return meta.vapid_present === true;
    case 'android':
    case 'any':     return true; // SA JSON alone authorizes sending
    default:        return false;
  }
}

function toResolved(row: CredRow): ResolvedCredential {
  const plaintext = decryptSecret({
    ciphertext: row.secretCiphertext,
    nonce:      row.secretNonce,
    tag:        row.secretTag,
    keyVersion: row.keyVersion,
  });
  return {
    id:       row.id,
    appId:    row.appId,
    provider: row.provider as Provider,
    platform: row.platform as ResolvedCredential['platform'],
    // FCM: SA JSON object. Huawei: pinned { appId, appSecret, projectId? } object.
    secret:   JSON.parse(plaintext),
    meta:     (row.metaJsonb ?? {}) as Record<string, unknown>,
  };
}

export async function resolveCredential(
  appId: string,
  provider: Provider,
  platform: DevicePlatform,
): Promise<
  | { ready: true; credential: ResolvedCredential }
  | { ready: false; reason: 'NOT_CONFIGURED' | 'NOT_READY' }
> {
  const rows = await db
    .select()
    .from(appCredentials)
    .where(and(eq(appCredentials.appId, appId), eq(appCredentials.provider, provider)));

  // Prefer exact platform match; fall back to platform='any' catch-all for the provider.
  const exact  = rows.find((r) => r.platform === platform);
  const anyRow = rows.find((r) => r.platform === 'any');
  const row = exact ?? anyRow;

  if (!row)          return { ready: false, reason: 'NOT_CONFIGURED' };
  if (!isReady(row)) return { ready: false, reason: 'NOT_READY' };
  return { ready: true, credential: toResolved(row) };
}
