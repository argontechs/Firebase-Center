import { db } from '~~/server/db/client';
import { appCredentials } from '~~/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encryptSecret } from '~~/server/utils/crypto';
import { toCredentialMeta, type CredentialMeta } from '~~/server/utils/credentials/meta';
import { audit } from '~~/server/utils/audit';

export interface RotateCredentialInput {
  appId: string;
  credentialId: string;
  userId: string;
  secret: string;
  meta?: Record<string, unknown>;
}

export async function rotateCredential(input: RotateCredentialInput): Promise<CredentialMeta> {
  if (!input.secret || input.secret.length === 0) throw new Error('secret is required');
  const enc = encryptSecret(input.secret);

  const updateValues: Record<string, unknown> = {
    secretCiphertext: enc.ciphertext,
    secretNonce: enc.nonce,
    secretTag: enc.tag,
    keyVersion: enc.keyVersion,
    rotatedAt: new Date(),
  };
  if (input.meta !== undefined) updateValues.metaJsonb = input.meta;

  // Scope the update to (id AND appId) so a credential cannot be rotated through another app's route.
  const [row] = await db.update(appCredentials)
    .set(updateValues)
    .where(and(eq(appCredentials.id, input.credentialId), eq(appCredentials.appId, input.appId)))
    .returning();

  if (!row) throw new Error('credential not found');

  await audit({
    userId: input.userId,
    action: 'credential_rotate',
    targetType: 'app_credential',
    targetId: row.id,
    meta: { appId: input.appId, provider: row.provider, platform: row.platform },
  });

  return toCredentialMeta(row, input.secret);
}
