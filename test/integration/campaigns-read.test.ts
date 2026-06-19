process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * M6.7 integration tests:
 *   GET /api/campaigns?appId=  — summary counts per campaign
 *   GET /api/campaigns/:id     — campaign detail + deliveries
 *
 * Auth: real operator session via seedUser + authedFetch (M1 harness).
 * GET routes enforce readSession only (no CSRF).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices, campaigns, deliveries } from '~~/server/db/schema';

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

  const [c] = await db.insert(companies).values({ name: `TestCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'TestApp' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

// ---------------------------------------------------------------------------
// GET /api/campaigns?appId=
// ---------------------------------------------------------------------------
describe('GET /api/campaigns?appId=', () => {
  it('returns summary counts for each campaign', async () => {
    const [d] = await db.insert(devices).values({
      appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}`,
    }).returning();
    const [camp] = await db.insert(campaigns).values({
      appId, title: 'T', body: 'B', targetType: 'all', status: 'done',
    }).returning();

    await db.insert(deliveries).values([
      { campaignId: camp.id, deviceId: d.id, provider: 'fcm', platform: 'android', token: 'a', status: 'sent' },
      { campaignId: camp.id, deviceId: d.id, provider: 'fcm', platform: 'android', token: 'b', status: 'invalid', disposition: 'DELETE_TOKEN' },
      { campaignId: camp.id, deviceId: d.id, provider: 'huawei', platform: 'huawei', token: 'c', status: 'failed', disposition: 'CREDENTIAL_NOT_READY' },
      { campaignId: camp.id, deviceId: d.id, provider: 'fcm', platform: 'android', token: 'd', status: 'gave_up', disposition: 'RETRY_BACKOFF' },
    ]);

    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(camp.id);
    expect(list[0].title).toBe('T');
    expect(list[0].status).toBe('done');
    expect(list[0].counts).toEqual({ sent: 1, failed: 1, invalid: 1, gave_up: 1, not_ready: 1 });
  });

  it('returns empty array when no campaigns exist', async () => {
    const list = await fetch(`/api/campaigns?appId=${appId}`);
    expect(list).toEqual([]);
  });

  it('rejects missing appId with 400', async () => {
    await expect(fetch('/api/campaigns')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 401 for unauthenticated request', async () => {
    await expect(testApp.$fetch('/api/campaigns?appId=' + appId)).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id
// ---------------------------------------------------------------------------
describe('GET /api/campaigns/:id', () => {
  it('returns campaign + deliveries list', async () => {
    const [d] = await db.insert(devices).values({
      appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}`,
    }).returning();
    const [camp] = await db.insert(campaigns).values({
      appId, title: 'Detail', body: 'Body', targetType: 'all',
    }).returning();
    await db.insert(deliveries).values({
      campaignId: camp.id, deviceId: d.id, provider: 'fcm', platform: 'android', token: 'a', status: 'sent',
    });

    const res = await fetch(`/api/campaigns/${camp.id}`);
    expect(res.campaign.id).toBe(camp.id);
    expect(res.campaign.title).toBe('Detail');
    expect(res.deliveries).toHaveLength(1);
    expect(res.deliveries[0].token).toBe('a');
    expect(res.deliveries[0].status).toBe('sent');
  });

  it('returns 404 for unknown campaign id', async () => {
    await expect(
      fetch('/api/campaigns/00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 for unauthenticated request', async () => {
    const [camp] = await db.insert(campaigns).values({
      appId, title: 'T', body: 'B', targetType: 'all',
    }).returning();
    await expect(testApp.$fetch(`/api/campaigns/${camp.id}`)).rejects.toMatchObject({ statusCode: 401 });
  });
});
