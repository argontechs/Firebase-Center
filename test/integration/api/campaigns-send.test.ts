process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * E1 integration tests:
 *   POST /api/campaigns — segment sends + scheduledAt behaviour
 *
 * (a) segment send: targetType:'segment', targetValue:{filter:{tag:'vip'}}
 *     enqueues jobs only for the vip-tagged devices.
 * (b) scheduledAt in the future → campaign row status:'scheduled', jobsCreated:0, no jobs rows.
 * (c) scheduledAt in the past/absent → behaves as today (status:'queued' + enqueued).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices, campaigns, jobs, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId: string;

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

  const [c] = await db.insert(companies).values({ name: `TestCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'TestApp' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

// ---------------------------------------------------------------------------
// (a) segment send
// ---------------------------------------------------------------------------
describe('POST /api/campaigns — segment send', () => {
  it('enqueues jobs only for vip-tagged devices', async () => {
    // Seed: two vip devices + one non-vip
    await db.insert(devices).values([
      { appId, provider: 'fcm', platform: 'android', token: 'tok_vip1', tags: ['vip'] },
      { appId, provider: 'fcm', platform: 'android', token: 'tok_vip2', tags: ['vip', 'kl'] },
      { appId, provider: 'fcm', platform: 'android', token: 'tok_plain', tags: [] },
    ]);

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'VIP Push', body: 'Hello VIPs', data: {},
        mode: 'notification', priority: 'high',
        targetType: 'segment',
        targetValue: { filter: { tag: 'vip' } },
        providerScope: 'both',
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.jobsCreated).toBeGreaterThan(0);

    // Campaign should be queued/sending (not draft or scheduled)
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    expect(camp.status).toBe('queued');
    expect(camp.targetType).toBe('segment');

    // Jobs should have been created
    const j = await db.select().from(jobs).where(eq(jobs.campaignId, res.campaignId));
    expect(j.length).toBeGreaterThan(0);
  });

  it('returns jobsCreated:0 for segment with no matching devices', async () => {
    // Only plain device, no 'vip' tag
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok_plain', tags: [] });

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'No Match', body: 'Nobody here', data: {},
        mode: 'notification', priority: 'high',
        targetType: 'segment',
        targetValue: { filter: { tag: 'vip' } },
        providerScope: 'both',
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.jobsCreated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) scheduledAt in the future → status:'scheduled', jobsCreated:0
// ---------------------------------------------------------------------------
describe('POST /api/campaigns — scheduledAt future', () => {
  it('stores campaign as scheduled, no jobs created', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok_a' });

    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'Scheduled', body: 'Later', data: {},
        mode: 'notification', priority: 'high',
        targetType: 'all', targetValue: {}, providerScope: 'both',
        scheduledAt: futureDate,
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.scheduled).toBe(true);
    expect(res.jobsCreated).toBe(0);

    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    expect(camp.status).toBe('scheduled');
    expect(camp.scheduledAt).toBeTruthy();

    // No jobs should have been created
    const j = await db.select().from(jobs).where(eq(jobs.campaignId, res.campaignId));
    expect(j).toHaveLength(0);

    // Audit should record campaign_scheduled
    const a = await db.select().from(auditLog).where(eq(auditLog.action, 'campaign_scheduled'));
    expect(a).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (c) scheduledAt in the past → immediate send (queued + enqueued)
// ---------------------------------------------------------------------------
describe('POST /api/campaigns — scheduledAt past', () => {
  it('treats past scheduledAt as immediate send', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok_b' });

    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'Past Scheduled', body: 'Now', data: {},
        mode: 'notification', priority: 'high',
        targetType: 'all', targetValue: {}, providerScope: 'both',
        scheduledAt: pastDate,
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.scheduled).toBeFalsy();
    expect(res.jobsCreated).toBeGreaterThan(0);

    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    expect(camp.status).toBe('queued');
  });

  it('no scheduledAt → immediate send (existing behaviour)', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok_c' });

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'Immediate', body: 'Now', data: {},
        mode: 'notification', priority: 'high',
        targetType: 'all', targetValue: {}, providerScope: 'both',
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.jobsCreated).toBeGreaterThan(0);

    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    expect(camp.status).toBe('queued');
  });
});
