/**
 * D1 integration tests: GET /api/devices (operator-authed, cross-app, keyset paginated)
 *
 * Route: GET /api/devices?appId=&platform=&provider=&tag=&q=&limit=&cursor=
 * Returns: { devices: [...], nextCursor? }
 * - operator-session auth required (401 without)
 * - tokens are masked (first 6 chars + ... + last 6 chars)
 * - filters by appId, platform, provider, tag, q (token or externalUserId substring)
 * - keyset pagination on (created_at desc, id desc) via limit+cursor
 */

process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices } from '~~/server/db/schema';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId: string;
let appBId: string;

beforeAll(async () => {
  testApp = await makeTestApp();
});

beforeEach(async () => {
  await resetDb();
  auth = await seedUser({ role: 'operator' });
  fetch = authedFetch(testApp.nodeListener, auth);

  const [c] = await db.insert(companies).values({ name: `Co-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'AppA' }).returning();
  appId = a.id;

  const [c2] = await db.insert(companies).values({ name: `Co2-${Math.random().toString(36).slice(2)}` }).returning();
  const [a2] = await db.insert(apps).values({ companyId: c2.id, name: 'AppB' }).returning();
  appBId = a2.id;
});

afterAll(async () => { await closeDb(); });

// Helper: insert a device
async function seedDevice(targetAppId: string, overrides: Partial<typeof devices.$inferInsert> & { token: string }) {
  const [d] = await db.insert(devices).values({
    appId: targetAppId,
    provider: 'fcm',
    platform: 'android',
    ...overrides,
  }).returning();
  return d;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
describe('GET /api/devices — auth', () => {
  it('returns 401 without a session', async () => {
    await expect(testApp.$fetch(`/api/devices?appId=${appId}`)).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// Basic listing + token masking
// ---------------------------------------------------------------------------
describe('GET /api/devices — basic list + masked tokens', () => {
  it('returns devices for the given appId with masked tokens', async () => {
    await seedDevice(appId, { token: 'ABCDEF123456GHIJKL', provider: 'fcm', platform: 'android' });
    await seedDevice(appId, { token: 'XXXXXXXXXXYYYYYY', provider: 'fcm', platform: 'ios' });

    const res = await fetch(`/api/devices?appId=${appId}`);
    expect(Array.isArray(res.devices)).toBe(true);
    expect(res.devices).toHaveLength(2);

    for (const d of res.devices) {
      // masked: first 6 + '...' + last 6
      expect(d.token).toMatch(/^.{6}\.\.\.{3}.{6}$|^.{6}…+.{6}$/);
      // raw token must NOT appear
      expect(['ABCDEF123456GHIJKL', 'XXXXXXXXXXYYYYYY']).not.toContain(d.token);
    }
  });

  it('does not return devices from other apps', async () => {
    await seedDevice(appId, { token: 'APPATOK111111' });
    await seedDevice(appBId, { token: 'APPBTOK222222' });

    const res = await fetch(`/api/devices?appId=${appId}`);
    expect(res.devices).toHaveLength(1);
  });

  it('returns empty list when no appId provided and no devices', async () => {
    const res = await fetch(`/api/devices`);
    expect(Array.isArray(res.devices)).toBe(true);
    expect(res.devices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
describe('GET /api/devices — filtering', () => {
  beforeEach(async () => {
    // Seed: fcm/android vip, fcm/ios no-tag, huawei/huawei vip, fcm/android no-tag
    await seedDevice(appId, { token: 'TOK_FCM_AND_VIP', provider: 'fcm', platform: 'android', tags: ['vip'], externalUserId: 'user-vip' });
    await seedDevice(appId, { token: 'TOK_FCM_IOS_NOTAG', provider: 'fcm', platform: 'ios' });
    await seedDevice(appId, { token: 'TOK_HW_HW_VIP', provider: 'huawei', platform: 'huawei', tags: ['vip'] });
    await seedDevice(appId, { token: 'TOK_FCM_AND_NOTAG', provider: 'fcm', platform: 'android' });
  });

  it('filters by platform', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&platform=android`);
    expect(res.devices).toHaveLength(2);
  });

  it('filters by provider', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&provider=huawei`);
    expect(res.devices).toHaveLength(1);
  });

  it('filters by tag', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&tag=vip`);
    expect(res.devices).toHaveLength(2);
  });

  it('filters by platform + tag (intersection)', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&platform=android&tag=vip`);
    expect(res.devices).toHaveLength(1);
  });

  it('filters by q matching externalUserId substring', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&q=user-vip`);
    expect(res.devices).toHaveLength(1);
  });

  it('filters by q matching token substring (masked: raw token no longer visible but the underlying filter still matches)', async () => {
    // q filter is on the raw token in the DB; the response masked token is separate
    const res = await fetch(`/api/devices?appId=${appId}&q=FCM_AND_VIP`);
    expect(res.devices).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Keyset pagination
// ---------------------------------------------------------------------------
describe('GET /api/devices — pagination', () => {
  beforeEach(async () => {
    // Insert 5 devices so we can page through them
    for (let i = 1; i <= 5; i++) {
      await seedDevice(appId, { token: `PAGTOKEN_${String(i).padStart(6, '0')}` });
    }
  });

  it('returns limit+1 detection: nextCursor present when more rows exist', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&limit=3`);
    expect(res.devices).toHaveLength(3);
    expect(res.nextCursor).toBeTruthy();
  });

  it('returns no nextCursor when all rows fit in limit', async () => {
    const res = await fetch(`/api/devices?appId=${appId}&limit=10`);
    expect(res.devices).toHaveLength(5);
    expect(res.nextCursor).toBeFalsy();
  });

  it('returns the next page using cursor', async () => {
    const page1 = await fetch(`/api/devices?appId=${appId}&limit=3`);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await fetch(`/api/devices?appId=${appId}&limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`);
    expect(page2.devices).toHaveLength(2);
    expect(page2.nextCursor).toBeFalsy();

    // No overlap between pages
    const ids1 = page1.devices.map((d: any) => d.id);
    const ids2 = page2.devices.map((d: any) => d.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
