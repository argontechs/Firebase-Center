import { db } from '~~/server/db/client';
import { appCredentials } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { encryptSecret, decryptSecret } from '~~/server/utils/crypto';
import { audit } from '~~/server/utils/audit';

// Decrypts each app_credentials row with its stored key_version and re-encrypts with the highest
// configured key version. Rows already at the highest version are skipped. Runs in one transaction
// so a mid-rotation failure leaves the table consistent (all-old or all-new per row, never partial).
export async function rotateMasterKey(input: { userId: string }): Promise<{ reEncrypted: number; toVersion: number }> {
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(appCredentials);
    // encryptSecret stamps the highest configured version; probe it once with a throwaway value.
    const toVersion = encryptSecret('probe').keyVersion;
    let reEncrypted = 0;

    for (const row of rows) {
      if (row.keyVersion === toVersion) continue;
      const plaintext = decryptSecret({
        ciphertext: row.secretCiphertext,
        nonce: row.secretNonce,
        tag: row.secretTag,
        keyVersion: row.keyVersion,
      });
      const enc = encryptSecret(plaintext);  // re-encrypts under the highest version with a fresh nonce
      await tx.update(appCredentials).set({
        secretCiphertext: enc.ciphertext,
        secretNonce: enc.nonce,
        secretTag: enc.tag,
        keyVersion: enc.keyVersion,
      }).where(eq(appCredentials.id, row.id));
      reEncrypted += 1;
    }
    return { reEncrypted, toVersion };
  });

  await audit({
    userId: input.userId,
    action: 'master_key_rotation',
    targetType: 'app_credentials',
    meta: { reEncrypted: result.reEncrypted, toVersion: result.toVersion },
  });

  return result;
}
