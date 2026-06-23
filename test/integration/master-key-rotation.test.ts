import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '~/server/db/client';
import { appCredentials, apps, companies, users, auditLog } from '~/server/db/schema';
import { decryptSecret } from '~/server/utils/crypto';
import { saveCredential } from '~/server/utils/credentials/save';
import { rotateMasterKey } from '~/server/utils/credentials/rotate-master-key';
import { resetDb } from '~/server/test/db';
import { eq } from 'drizzle-orm';

// Ensure the master key is set for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let appId = '', userId = '';
const SENTINEL = 'MASTER_ROTATE_SENTINEL';
const saJson = JSON.stringify({ project_id: 'proj-1', private_key: SENTINEL });
const v1Key = process.env.NUXT_BO_MASTER_KEY!;          // "1:<b64>"

beforeEach(async () => {
  await resetDb();
  const [u] = await db.insert(users).values({ email: 'admin@x.io', passwordHash: 'h', role: 'admin' }).returning();
  userId = u.id;
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'App' }).returning();
  appId = a.id;
  process.env.NUXT_BO_MASTER_KEY = v1Key;               // start with only v1
});

afterEach(() => { process.env.NUXT_BO_MASTER_KEY = v1Key; });

it('re-encrypts every row to the highest key version and the secret still decrypts', async () => {
  const saved = await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-1' } });
  const [before] = await db.select().from(appCredentials).where(eq(appCredentials.id, saved.id));
  expect(before.keyVersion).toBe(1);

  // Operator adds a v2 key (highest version encrypts) before rotating.
  const v2 = randomBytes(32).toString('base64');
  process.env.NUXT_BO_MASTER_KEY = `2:${v2},${v1Key}`;

  const result = await rotateMasterKey({ userId });
  expect(result.reEncrypted).toBe(1);
  expect(result.toVersion).toBe(2);

  const [after] = await db.select().from(appCredentials).where(eq(appCredentials.id, saved.id));
  expect(after.keyVersion).toBe(2);
  expect(after.secretCiphertext).not.toBe(before.secretCiphertext);
  expect(decryptSecret({ ciphertext: after.secretCiphertext, nonce: after.secretNonce, tag: after.secretTag, keyVersion: after.keyVersion })).toBe(saJson);
});

it('writes a master_key_rotation audit row that never leaks the secret', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-1' } });
  const v2 = randomBytes(32).toString('base64');
  process.env.NUXT_BO_MASTER_KEY = `2:${v2},${v1Key}`;
  await rotateMasterKey({ userId });
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'master_key_rotation'));
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(SENTINEL);
  expect(audits[0].metaJsonb).toMatchObject({ reEncrypted: 1, toVersion: 2 });
});

it('is a no-op (zero rows) when already at the highest version', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-1' } });
  // Still only v1 configured: row already at the highest version.
  const result = await rotateMasterKey({ userId });
  expect(result.reEncrypted).toBe(0);
  expect(result.toVersion).toBe(1);
});
