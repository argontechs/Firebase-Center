process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * G5 integration tests:
 *   GET /api/campaigns?appId= — extended to include scheduled + canceled campaigns,
 *   broadcastId grouping hint, scheduledAt field.
 *
 * Also tests the optional appId filter (no appId returns all for visible apps or
 * requires an explicit filter — depends on current implementation; if appId stays
 * required the test asserts 400 on missing appId, which already passes from
 * the existing campaigns-read suite; here we focus on the new fields).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, campaigns } from '~~/server/db/schema';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId: string;

beforeAll(async () => {
  testApp = await makeTestApp();
});

beforeEach(async () => {
  await resetDb();
  auth = await seedUser({ role: 'admin' });
  fetch = authedFetch(testApp.nodeListener, auth);

  const [c] = await db.insert(companies).values({ name: `HistoryCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'HistoryApp' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

describe('GET /api/campaigns?appId= (G5 extensions)', () => {
  it('includes scheduled campaigns in the list with scheduledAt field', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(campaigns).values({
      appId,
      title: 'Scheduled',
      body: 'Coming soon',
      targetType: 'all',
      status: 'scheduled',
      scheduledAt: futureDate,
    });

    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('scheduled');
    expect(list[0].scheduledAt).toBeTruthy();
  });

  it('includes canceled campaigns in the list', async () => {
    await db.insert(campaigns).values({
      appId,
      title: 'Canceled',
      body: 'Was scheduled',
      targetType: 'all',
      status: 'canceled',
    });

    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('canceled');
  });

  it('includes broadcastId in the list row', async () => {
    const broadcastId = '00000000-0000-0000-0000-000000000099';
    await db.insert(campaigns).values({
      appId,
      title: 'Broadcast Push',
      body: 'To all',
      targetType: 'all',
      status: 'done',
      broadcastId,
    });

    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toHaveLength(1);
    expect(list[0].broadcastId).toBe(broadcastId);
  });

  it('returns both scheduled and done campaigns together', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(campaigns).values([
      { appId, title: 'Done', body: 'B', targetType: 'all', status: 'done' },
      { appId, title: 'Scheduled', body: 'B', targetType: 'all', status: 'scheduled', scheduledAt: futureDate },
      { appId, title: 'Canceled', body: 'B', targetType: 'all', status: 'canceled' },
    ]);

    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toHaveLength(3);
    const statuses = list.map((c: { status: string }) => c.status).sort();
    expect(statuses).toEqual(['canceled', 'done', 'scheduled']);
  });
});
