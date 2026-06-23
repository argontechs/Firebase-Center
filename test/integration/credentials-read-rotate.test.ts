import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~/server/db/client';
import { appCredentials, apps, companies, users, auditLog } from '~/server/db/schema';
import { decryptSecret } from '~/server/utils/crypto';
import { saveCredential } from '~/server/utils/credentials/save';
import { listCredentials } from '~/server/utils/credentials/list';
import { rotateCredential } from '~/server/utils/credentials/rotate';
import { resetDb } from '~/server/test/db';
import { eq } from 'drizzle-orm';

// Ensure the master key is set for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let appId = '', userId = '';
const saJson = JSON.stringify({ project_id: 'proj-1', private_key: '-----BEGIN-----secret1-----END-----' });

beforeEach(async () => {
  await resetDb();
  const [u] = await db.insert(users).values({ email: 'op@x.io', passwordHash: 'h' }).returning();
  userId = u.id;
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'App' }).returning();
  appId = a.id;
});

it('list returns metadata only — never ciphertext or decrypted secret', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'ios', secret: saJson, meta: { project_id: 'proj-1' } });
  const list = await listCredentials(appId);
  expect(list).toHaveLength(1);
  const blob = JSON.stringify(list);
  expect(blob).not.toContain('private_key');
  expect(blob).not.toContain('BEGIN');
  expect((list[0] as any).secretCiphertext).toBeUndefined();
  expect((list[0] as any).secret).toBeUndefined();
  expect(list[0].ready).toBe(false);             // FCM ios without apns_p8_uploaded
  expect(list[0].projectId).toBe('proj-1');
});

it('rotate re-encrypts the new secret, sets rotated_at, and audits credential_rotate', async () => {
  const saved = await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'proj-1' } });
  const newSecret = JSON.stringify({ project_id: 'proj-1', private_key: '-----BEGIN-----secret2-----END-----' });
  const rotated = await rotateCredential({ appId, credentialId: saved.id, userId, secret: newSecret, meta: { project_id: 'proj-1' } });

  expect(rotated.id).toBe(saved.id);
  expect(rotated.rotatedAt).not.toBeNull();

  const [row] = await db.select().from(appCredentials).where(eq(appCredentials.id, saved.id));
  expect(decryptSecret({ ciphertext: row.secretCiphertext, nonce: row.secretNonce, tag: row.secretTag, keyVersion: row.keyVersion })).toBe(newSecret);

  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential_rotate'));
  expect(audits).toHaveLength(1);
  expect(audits[0].targetId).toBe(saved.id);
  expect(JSON.stringify(audits[0].metaJsonb)).not.toContain('secret2');
});

it('rotate of a credential belonging to another app throws', async () => {
  const saved = await saveCredential({ appId, userId, provider: 'fcm', platform: 'web', secret: saJson, meta: { vapid_present: true } });
  const [c2] = await db.insert(companies).values({ name: 'Other' }).returning();
  const [a2] = await db.insert(apps).values({ companyId: c2.id, name: 'Other App' }).returning();
  await expect(rotateCredential({ appId: a2.id, credentialId: saved.id, userId, secret: saJson })).rejects.toThrow(/not found/i);
});
