/**
 * Task D3: Bulk import learns `tags`
 *
 * Tests that the import pipeline correctly handles an optional `tags` column
 * in CSV/JSON input, splitting on [;,] and trimming entries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// Set DB URL before anything imports db/client
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
import { db, resetDb } from '~~/server/test/db';
import { runImport } from './run';
import { companies, apps, devices } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let appId: string;

beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'TagsCo' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'TagsApp' }).returning();
  appId = a.id;
});

describe('device import: tags column', () => {
  it('imports devices with tags split on semicolon', async () => {
    const csv = 'tok,prov,plat,tags\nT1,fcm,android,"vip;kl"\n';
    const res = await runImport({
      db,
      appId,
      userId: null,
      filename: 'tags.csv',
      raw: csv,
      format: 'csv',
      mapping: { token: 'tok', provider: 'prov', platform: 'plat', tags: 'tags' },
      defaults: {},
    });
    expect(res.inserted).toBe(1);
    const [device] = await db.select().from(devices).where(eq(devices.appId, appId));
    expect(device.tags).toEqual(['vip', 'kl']);
  });

  it('imports devices with tags split on comma', async () => {
    const csv = 'tok,prov,plat,tags\nT2,fcm,android,"vip,kl"\n';
    const res = await runImport({
      db,
      appId,
      userId: null,
      filename: 'tags-comma.csv',
      raw: csv,
      format: 'csv',
      mapping: { token: 'tok', provider: 'prov', platform: 'plat', tags: 'tags' },
      defaults: {},
    });
    expect(res.inserted).toBe(1);
    const [device] = await db.select().from(devices).where(eq(devices.appId, appId));
    expect(device.tags).toEqual(['vip', 'kl']);
  });

  it('imports devices with no tags column defaulting to empty array', async () => {
    const csv = 'tok,prov,plat\nT3,fcm,android\n';
    const res = await runImport({
      db,
      appId,
      userId: null,
      filename: 'no-tags.csv',
      raw: csv,
      format: 'csv',
      mapping: { token: 'tok', provider: 'prov', platform: 'plat' },
      defaults: {},
    });
    expect(res.inserted).toBe(1);
    const [device] = await db.select().from(devices).where(eq(devices.appId, appId));
    expect(device.tags).toEqual([]);
  });

  it('trims whitespace and drops empty entries', async () => {
    const csv = 'tok,prov,plat,tags\nT4,fcm,android," vip ; ; kl "\n';
    const res = await runImport({
      db,
      appId,
      userId: null,
      filename: 'tags-trim.csv',
      raw: csv,
      format: 'csv',
      mapping: { token: 'tok', provider: 'prov', platform: 'plat', tags: 'tags' },
      defaults: {},
    });
    expect(res.inserted).toBe(1);
    const [device] = await db.select().from(devices).where(eq(devices.appId, appId));
    expect(device.tags).toEqual(['vip', 'kl']);
  });
});
