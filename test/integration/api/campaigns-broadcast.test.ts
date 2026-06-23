process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * E2 integration tests:
 *   POST /api/campaigns/broadcast — multi-app broadcast sharing a broadcastId
 *
 * - two apps each with devices; broadcast recipients:{type:'all'} creates one
 *   campaign per app, all sharing one broadcastId, each enqueued (or scheduled).
 * - empty appIds → 422.
 * - requireSession (401 without auth).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices, campaigns, jobs } from '~~/server/db/schema';
import { eq, inArray } from 'drizzle-orm';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId1: string;
let appId2: string;

beforeAll(async () => {
  testApp = await makeTestApp();
  // Stub resolveCredential so FCM groups report ready=true
  const resolveModule = await import('~~/server/utils/credentials/resolve');
  vi.spyOn(resolveModule, 'resolveCredential').mockImplementation(
    async (_appId: string, provider: string) =>
      provider === 'fcm'
        ? { ready: true, credential: { id: 'c', appId: _appId, provider: 'fcm', platform: 'android', secret: {}, meta: {} } }
        : { ready: false, reason: 'NOT_CONFIGURED' },
  );
});

beforeEach(async () => {
  await resetDb();
  auth = await seedUser({ role: 'admin' });
  fetch = authedFetch(testApp.nodeListener, auth);

  const [c] = await db.insert(companies).values({ name: `BroadcastCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a1] = await db.insert(apps).values({ companyId: c.id, name: 'App1' }).returning();
  const [a2] = await db.insert(apps).values({ companyId: c.id, name: 'App2' }).returning();
  appId1 = a1.id;
  appId2 = a2.id;

  // Seed one device per app
  await db.insert(devices).values([
    { appId: appId1, provider: 'fcm', platform: 'android', token: 'tok_app1' },
    { appId: appId2, provider: 'fcm', platform: 'android', token: 'tok_app2' },
  ]);
});

afterAll(async () => { await closeDb(); });

describe('POST /api/campaigns/broadcast', () => {
  it('creates one campaign per app sharing a broadcastId, each enqueued', async () => {
    const res = await fetch('/api/campaigns/broadcast', {
      method: 'POST',
      body: {
        appIds: [appId1, appId2],
        message: {
          title: 'Hello Everyone',
          body: 'Broadcast message',
          data: {},
          mode: 'notification',
          priority: 'high',
        },
        recipients: { type: 'all' },
        providerScope: 'both',
      },
    });

    expect(res.broadcastId).toBeTruthy();
    expect(res.campaignIds).toHaveLength(2);

    // Both campaigns should share the same broadcastId
    const camps = await db.select().from(campaigns).where(inArray(campaigns.id, res.campaignIds));
    expect(camps).toHaveLength(2);
    const broadcastIds = camps.map(c => c.broadcastId);
    expect(broadcastIds[0]).toBe(res.broadcastId);
    expect(broadcastIds[1]).toBe(res.broadcastId);

    // Each should be queued (not scheduled) since no scheduledAt
    for (const camp of camps) {
      expect(camp.status).toBe('queued');
    }

    // Each campaign should have jobs
    const allJobs = await db.select().from(jobs).where(inArray(jobs.campaignId, res.campaignIds));
    expect(allJobs.length).toBeGreaterThanOrEqual(2);
  });

  it('creates scheduled campaigns when scheduledAt is in the future', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await fetch('/api/campaigns/broadcast', {
      method: 'POST',
      body: {
        appIds: [appId1, appId2],
        message: {
          title: 'Future Broadcast',
          body: 'Coming soon',
          data: {},
          mode: 'notification',
          priority: 'high',
        },
        recipients: { type: 'all' },
        providerScope: 'both',
        scheduledAt: futureDate,
      },
    });

    expect(res.broadcastId).toBeTruthy();
    expect(res.campaignIds).toHaveLength(2);

    const camps = await db.select().from(campaigns).where(inArray(campaigns.id, res.campaignIds));
    for (const camp of camps) {
      expect(camp.status).toBe('scheduled');
      expect(camp.broadcastId).toBe(res.broadcastId);
    }

    // No jobs should have been created
    const allJobs = await db.select().from(jobs).where(inArray(jobs.campaignId, res.campaignIds));
    expect(allJobs).toHaveLength(0);
  });

  it('returns 422 for empty appIds', async () => {
    await expect(
      fetch('/api/campaigns/broadcast', {
        method: 'POST',
        body: {
          appIds: [],
          message: { title: 'X', body: 'Y', data: {}, mode: 'notification', priority: 'high' },
          recipients: { type: 'all' },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 401 without authentication', async () => {
    const { default: request } = await import('supertest');
    const res = await request(testApp.nodeListener)
      .post('/api/campaigns/broadcast')
      .send({ appIds: [appId1], message: { title: 'X', body: 'Y' }, recipients: { type: 'all' } })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
  });
});
