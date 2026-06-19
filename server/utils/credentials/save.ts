import { db } from '~~/server/db/client';
import { appCredentials } from '~~/server/db/schema';
import { encryptSecret } from '~~/server/utils/crypto';
import { toCredentialMeta, type CredentialMeta } from '~~/server/utils/credentials/meta';
import { audit } from '~~/server/utils/audit';

const VALID_PROVIDERS = ['fcm', 'huawei'] as const;
const VALID_PLATFORMS = ['ios', 'android', 'huawei', 'web', 'any'] as const;

export interface SaveCredentialInput {
  appId: string;
  userId: string;
  provider: 'fcm' | 'huawei';
  platform: 'ios' | 'android' | 'huawei' | 'web' | 'any';
  label?: string | null;
  secret: string;                     // SA JSON (FCM) or App Secret (Huawei) — never persisted in plaintext
  meta?: Record<string, unknown>;     // non-secret display/readiness fields
}

export async function saveCredential(input: SaveCredentialInput): Promise<CredentialMeta> {
  if (!(VALID_PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new Error(`invalid provider: ${input.provider}`);
  }
  if (!(VALID_PLATFORMS as readonly string[]).includes(input.platform)) {
    throw new Error(`invalid platform: ${input.platform}`);
  }
  if (!input.secret || input.secret.length === 0) {
    throw new Error('secret is required');
  }

  const enc = encryptSecret(input.secret);
  const [row] = await db.insert(appCredentials).values({
    appId: input.appId,
    provider: input.provider,
    platform: input.platform,
    label: input.label ?? null,
    secretCiphertext: enc.ciphertext,
    secretNonce: enc.nonce,
    secretTag: enc.tag,
    keyVersion: enc.keyVersion,
    metaJsonb: input.meta ?? {},
  }).returning();

  await audit({
    userId: input.userId,
    action: 'credential_save',
    targetType: 'app_credential',
    targetId: row.id,
    meta: { appId: input.appId, provider: input.provider, platform: input.platform },
  });

  return toCredentialMeta(row, input.secret);
}
