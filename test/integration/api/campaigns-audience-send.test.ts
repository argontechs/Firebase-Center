process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * FIX 1 regression tests:
 *   POST /api/campaigns — audience_id send resolves to the correct subset
 *   POST /api/campaigns/preview — audience_id preview returns subset count
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices, audiences, campaigns, jobs } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId: string;
let appId2: string;

beforeAll(async () => {
  testApp = await makeTestApp();
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

  const [c2] = await db.insert(companies).values({ name: `OtherCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a2] = await db.insert(apps).values({ companyId: c2.id, name: 'OtherApp' }).returning();
  appId2 = a2.id;
});

afterAll(async () => { await closeDb(); });

describe('POST /api/campaigns — audience_id send', () => {
  it('enqueues jobs only for devices matching the saved audience (not all devices)', async () => {
    // Seed: two android devices with vip tag + one non-vip
    const inserted = await db.insert(devices).values([
      { appId, provider: 'fcm', platform: 'android', token: 'tok_vip_a1', tags: ['vip'] },
      { appId, provider: 'fcm', platform: 'android', token: 'tok_vip_a2', tags: ['vip'] },
      { appId, provider: 'fcm', platform: 'android', token: 'tok_plain_a', tags: [] },
    ]).returning();

    const vipIds = inserted.filter(d => d.tags.includes('vip')).map(d => d.id).sort();
    const plainId = inserted.find(d => d.token === 'tok_plain_a')!.id;

    // Create a saved audience targeting android + vip tag
    const [aud] = await db.insert(audiences).values({
      appId,
      name: 'VIP Android',
      platform: 'android',
      tag: 'vip',
      createdBy: auth.userId,
    }).returning();

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      body: {
        appId,
        title: 'VIP Push',
        body: 'Hello VIPs',
        data: {},
        mode: 'notification',
        priority: 'high',
        targetType: 'segment',
        targetValue: { audience_id: aud.id },
        providerScope: 'both',
      },
    });

    expect(res.campaignId).toBeTruthy();
    expect(res.jobsCreated).toBeGreaterThan(0);

    // Campaign's targetValueJsonb must have the snapshotted filter
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.campaignId));
    const tv = camp.targetValueJsonb as { audience_id: string; filter?: { tag?: string } };
    expect(tv.filter).toBeTruthy();
    expect(tv.filter!.tag).toBe('vip');

    // Jobs must contain only vip device IDs
    const j = await db.select().from(jobs).where(eq(jobs.campaignId, res.campaignId));
    const jobDeviceIds = (j[0].payloadJsonb as { deviceIds: string[] }).deviceIds.slice().sort();
    expect(jobDeviceIds).toEqual(vipIds);
    expect(jobDeviceIds).not.toContain(plainId);
  });

  it('returns 404 when audience_id belongs to a different app', async () => {
    // Create audience under app2
    const [aud] = await db.insert(audiences).values({
      appId: appId2,
      name: 'Other App Audience',
      createdBy: auth.userId,
    }).returning();

    await expect(
      fetch('/api/campaigns', {
        method: 'POST',
        body: {
          appId,
          title: 'Test',
          body: 'Test',
          data: {},
          mode: 'notification',
          priority: 'high',
          targetType: 'segment',
          targetValue: { audience_id: aud.id },
          providerScope: 'both',
        },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('POST /api/campaigns/preview — audience_id preview', () => {
  it('returns subset count matching only the audience filter', async () => {
    await db.insert(devices).values([
      { appId, provider: 'fcm', platform: 'android', token: 'tok_vip_p1', tags: ['vip'] },
      { appId, provider: 'fcm', platform: 'android', token: 'tok_plain_p', tags: [] },
    ]);

    const [aud] = await db.insert(audiences).values({
      appId,
      name: 'VIP Preview',
      tag: 'vip',
      createdBy: auth.userId,
    }).returning();

    const res = await fetch('/api/campaigns/preview', {
      method: 'POST',
      body: {
        appId,
        title: 'Preview Test',
        body: 'Test body',
        data: {},
        mode: 'notification',
        priority: 'high',
        targetType: 'segment',
        targetValue: { audience_id: aud.id },
        providerScope: 'both',
      },
    });

    // Only 1 device (vip) should be in the preview, not 2
    const total = res.byGroup.reduce((s: number, g: { count: number }) => s + g.count, 0);
    expect(total).toBe(1);
  });
});
