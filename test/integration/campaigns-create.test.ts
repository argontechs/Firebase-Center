process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * M6.6 integration tests:
 *   POST /api/campaigns/preview  — audience preview with per-(provider,platform) counts + byte total
 *   POST /api/campaigns          — create campaign, validate payload, enqueue, audit
 *
 * Auth: real operator session + CSRF token via makeTestApp / seedUser / authedFetch (M1 harness).
 *
 * Credential readiness: no app_credentials rows are seeded, so resolveCredential returns
 * NOT_CONFIGURED (ready: false) for all groups by default.  For the FCM "ready" assertion we
 * use vi.spyOn (not vi.mock — avoids hoist/env-ordering issues) inside beforeAll.
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
  // Stub resolveCredential: FCM groups report ready=true; Huawei reports NOT_CONFIGURED.
  // Dynamic import used so DB env var is set (by server/test/db.ts import above) before
  // credentials/resolve loads its own db client import chain.
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
// POST /api/campaigns/preview
// ---------------------------------------------------------------------------
describe('POST /api/campaigns/preview', () => {
  it('returns per-(provider,platform) counts with readiness + byte total', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}` });
    await db.insert(devices).values({ appId, provider: 'huawei', platform: 'huawei', token: `tok_${Math.random().toString(36).slice(2)}` });

    const res = await fetch('/api/campaigns/preview', {
      method: 'POST',
      body: {
        appId, mode: 'notification', priority: 'high',
        targetType: 'all', targetValue: {}, providerScope: 'both',
        title: 'Hi', body: 'There', data: {},
      },
    });

    const fcm = res.byGroup.find((g: any) => g.provider === 'fcm');
    const huawei = res.byGroup.find((g: any) => g.provider === 'huawei');
    expect(fcm).toBeDefined();
    expect(fcm.count).toBe(1);
    expect(fcm.ready).toBe(true);
    expect(huawei).toBeDefined();
    expect(huawei.count).toBe(1);
    expect(huawei.ready).toBe(false);
    expect(res.withinLimit).toBe(true);
    expect(res.totalBytes).toBeGreaterThan(0);
  });

  it('flags withinLimit=false for an oversize payload', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}` });

    const res = await fetch('/api/campaigns/preview', {
      method: 'POST',
      body: {
        appId, mode: 'notification', priority: 'high',
        targetType: 'all', targetValue: {}, providerScope: 'both',
        title: 'Hi', body: 'There', data: { blob: 'x'.repeat(5000) },
      },
    });

    expect(res.withinLimit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/campaigns
// ---------------------------------------------------------------------------
describe('POST /api/campaigns', () => {
  it('creates a campaign, enqueues jobs, audits campaign_send', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}` });

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'Hi', body: 'There', data: {},
        mode: 'notification', priority: 'high', targetType: 'all', targetValue: {}, providerScope: 'both',
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.jobsCreated).toBe(1);

    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    expect(camp).toBeDefined();
    expect(camp.status).toBe('queued');

    const j = await db.select().from(jobs);
    expect(j).toHaveLength(1);

    const a = await db.select().from(auditLog).where(eq(auditLog.action, 'campaign_send'));
    expect(a).toHaveLength(1);
  });

  it('rejects target_type=segment with 422', async () => {
    await expect(fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'x', body: 'y', data: {},
        mode: 'notification', priority: 'high', targetType: 'segment', targetValue: {}, providerScope: 'both',
      },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects target_type=topic with 422', async () => {
    await expect(fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'x', body: 'y', data: {},
        mode: 'notification', priority: 'high', targetType: 'topic', targetValue: {}, providerScope: 'both',
      },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects an oversize payload with 413', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: `tok_${Math.random().toString(36).slice(2)}` });

    await expect(fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId, title: 'x', body: 'y', data: { blob: 'x'.repeat(5000) },
        mode: 'notification', priority: 'high', targetType: 'all', targetValue: {}, providerScope: 'both',
      },
    })).rejects.toMatchObject({ statusCode: 413 });
  });
});
