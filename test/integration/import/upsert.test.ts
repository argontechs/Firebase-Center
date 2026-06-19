import { describe, it, expect, beforeEach, afterAll } from 'vitest';
// server/test/db.ts sets NUXT_DATABASE_URL before importing db/client, so import it first.
import { db, resetDb, closeDb } from '~~/server/test/db';
import { upsertDevices } from '~~/server/utils/import/upsert';
import type { ValidRow } from '~~/server/utils/import/validate';
import { companies, apps, devices } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let appId: string;

beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'Acme Shopper' }).returning();
  appId = a.id;
});

afterAll(async () => {
  await closeDb();
});

const row = (over: Partial<ValidRow> = {}): ValidRow => ({
  rowNumber: 1, token: 'tok-a', provider: 'fcm', platform: 'android',
  externalUserId: null, attributes: {}, ...over,
});

describe('upsertDevices', () => {
  it('inserts new rows and counts inserted', async () => {
    const r = await upsertDevices(db, appId, [row({ token: 'tok-a' }), row({ token: 'tok-b', rowNumber: 2 })]);
    expect(r).toEqual({ inserted: 2, updated: 0 });
    const all = await db.select().from(devices).where(eq(devices.appId, appId));
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe('active');
  });

  it('updates existing row by (app_id, token), counting it as updated', async () => {
    await upsertDevices(db, appId, [row({ token: 'tok-a', externalUserId: 'old' })]);
    const r = await upsertDevices(db, appId, [row({ token: 'tok-a', externalUserId: 'new', platform: 'ios' })]);
    expect(r).toEqual({ inserted: 0, updated: 1 });
    const [d] = await db.select().from(devices).where(eq(devices.token, 'tok-a'));
    expect(d.externalUserId).toBe('new');
    expect(d.platform).toBe('ios');
    expect(d.lastSeenAt).not.toBeNull();
  });

  it('mixes insert + update in one batch', async () => {
    await upsertDevices(db, appId, [row({ token: 'tok-a' })]);
    const r = await upsertDevices(db, appId, [row({ token: 'tok-a' }), row({ token: 'tok-c', rowNumber: 2 })]);
    expect(r).toEqual({ inserted: 1, updated: 1 });
  });
});
