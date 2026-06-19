import type { appCredentials } from '~/server/db/schema';

type CredentialRow = typeof appCredentials.$inferSelect;

// SINGLE source of truth for readiness — imported verbatim by both M3 (save-time) and
// M5 (send-time resolveCredential). Do NOT re-implement elsewhere or rename the meta keys.
// A credential is ready when the row exists AND its meta_jsonb readiness flags are satisfied:
//   FCM ios -> apns_p8_uploaded; FCM web -> vapid_present; FCM android/any -> ready once configured.
//   Huawei (any platform) -> push_kit_enabled.
export function isReady(credentialRow: CredentialRow): boolean {
  const meta = (credentialRow.metaJsonb ?? {}) as Record<string, unknown>;
  if (credentialRow.provider === 'huawei') {
    return meta.push_kit_enabled === true;
  }
  // provider === 'fcm'
  switch (credentialRow.platform) {
    case 'ios': return meta.apns_p8_uploaded === true;
    case 'web': return meta.vapid_present === true;
    case 'android':
    case 'any':
      return true;
    default:
      return false;
  }
}
