import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~/server/db/client';
import { appCredentials, apps, companies, users, auditLog, devices } from '~/server/db/schema';
import { decryptSecret } from '~/server/utils/crypto';
import { eq } from 'drizzle-orm';
import { saveCredential } from '~/server/utils/credentials/save';

// Ensure the master key is set for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let appId = '';
let userId = '';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(appCredentials);
  await db.delete(devices);
  await db.delete(apps);
  await db.delete(companies);
  // sessions FK references users, so clear sessions first
  const { sessions } = await import('~/server/db/schema');
  await db.delete(sessions);
  await db.delete(users);
  const [u] = await db.insert(users).values({ email: 'op@x.io', passwordHash: 'h' }).returning();
  userId = u.id;
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'Acme Shopper' }).returning();
  appId = a.id;
});

const saJson = JSON.stringify({ project_id: 'proj-1', client_email: 'x@y.iam', private_key: '-----BEGIN-----' });

it('stores the secret encrypted (round-trips via DB) and returns metadata only', async () => {
  const meta = await saveCredential({
    appId, userId, provider: 'fcm', platform: 'android',
    label: 'Android prod', secret: saJson, meta: { project_id: 'proj-1' },
  });
  expect(meta.configured).toBe(true);
  expect(meta.projectId).toBe('proj-1');
  expect(meta.ready).toBe(true);
  expect(JSON.stringify(meta)).not.toContain('private_key');
  expect(JSON.stringify(meta)).not.toContain('BEGIN');

  const [row] = await db.select().from(appCredentials).where(eq(appCredentials.id, meta.id));
  expect(row.secretCiphertext).not.toContain('private_key');
  expect(decryptSecret({
    ciphertext: row.secretCiphertext, nonce: row.secretNonce, tag: row.secretTag, keyVersion: row.keyVersion,
  })).toBe(saJson);
});

it('writes a credential_save audit entry', async () => {
  const meta = await saveCredential({
    appId, userId, provider: 'huawei', platform: 'huawei',
    secret: 'app-secret-xyz', meta: { app_id: '10086', push_kit_enabled: true },
  });
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential_save'));
  expect(audits).toHaveLength(1);
  expect(audits[0].targetId).toBe(meta.id);
  expect(JSON.stringify(audits[0].metaJsonb)).not.toContain('app-secret-xyz');
});

it('enforces UNIQUE(app_id, provider, platform)', async () => {
  await saveCredential({ appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'p' } });
  await expect(saveCredential({
    appId, userId, provider: 'fcm', platform: 'android', secret: saJson, meta: { project_id: 'p' },
  })).rejects.toThrow();
});

it('rejects an invalid provider/platform pair', async () => {
  await expect(saveCredential({
    appId, userId, provider: 'fcm', platform: 'nonsense' as any, secret: saJson,
  })).rejects.toThrow(/platform/i);
});
