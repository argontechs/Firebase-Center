import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~/server/db/client';
import { appCredentials, apps, companies, users, auditLog, sessions } from '~/server/db/schema';
import { decryptSecret } from '~/server/utils/crypto';
import { saveCredential } from '~/server/utils/credentials/save';
import { rotateCredential } from '~/server/utils/credentials/rotate';
import { listCredentials } from '~/server/utils/credentials/list';
import { resetDb } from '~/server/test/db';
import { eq } from 'drizzle-orm';

// Ensure the master key is set for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let appId = '', userId = '';
const SENTINEL = 'PRIVATE_KEY_SENTINEL_DO_NOT_LEAK';
const saJson = JSON.stringify({ project_id: 'proj-9', client_email: 'x@y.iam', private_key: SENTINEL });

beforeEach(async () => {
  await resetDb();
  const [u] = await db.insert(users).values({ email: 'op@x.io', passwordHash: 'h' }).returning();
  userId = u.id;
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'App' }).returning();
  appId = a.id;
});

it('INVARIANT: no read path (list) ever returns the sentinel secret', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-9' } });
  const list = await listCredentials(appId);
  expect(JSON.stringify(list)).not.toContain(SENTINEL);
});

it('INVARIANT: the stored ciphertext is opaque (sentinel not present in any string column)', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-9' } });
  const [row] = await db.select().from(appCredentials);
  expect(row.secretCiphertext).not.toContain(SENTINEL);
  expect(row.secretNonce).not.toContain(SENTINEL);
  expect(row.secretTag).not.toContain(SENTINEL);
  expect(JSON.stringify(row.metaJsonb)).not.toContain(SENTINEL);
});

it('INVARIANT: ciphertext decrypts back to the exact secret (round-trip via DB)', async () => {
  const meta = await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-9' } });
  const [row] = await db.select().from(appCredentials).where(eq(appCredentials.id, meta.id));
  expect(decryptSecret({ ciphertext: row.secretCiphertext, nonce: row.secretNonce, tag: row.secretTag, keyVersion: row.keyVersion })).toBe(saJson);
});

it('INVARIANT: save then rotate produces exactly two audit rows, neither leaking the secret', async () => {
  const saved = await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-9' } });
  await rotateCredential({ appId, credentialId: saved.id, userId, secret: JSON.stringify({ private_key: 'ROTATED_SENTINEL' }), meta: { project_id: 'proj-9' } });
  const audits = await db.select().from(auditLog);
  const actions = audits.map((a) => a.action).sort();
  expect(actions).toEqual(['credential_rotate', 'credential_save']);
  const blob = JSON.stringify(audits);
  expect(blob).not.toContain(SENTINEL);
  expect(blob).not.toContain('ROTATED_SENTINEL');
});

it('INVARIANT: two encryptions of the same secret have different nonces in the DB (no key,nonce reuse)', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-9' } });
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'ios', secret: saJson, meta: { project_id: 'proj-9', apns_p8_uploaded: true } });
  const rows = await db.select().from(appCredentials);
  expect(rows[0].secretNonce).not.toBe(rows[1].secretNonce);
  expect(rows[0].secretCiphertext).not.toBe(rows[1].secretCiphertext);
});
