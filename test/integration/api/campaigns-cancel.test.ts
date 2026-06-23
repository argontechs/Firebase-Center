process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * E3 integration tests:
 *   POST /api/campaigns/:id/cancel — cancel a scheduled campaign
 *
 * - a `scheduled` campaign cancels → status:'canceled'
 * - cancelling a `queued`/`sending` campaign → 409
 * - unknown id → 404
 * - requireSession (401 without auth)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices, campaigns, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

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

  const [c] = await db.insert(companies).values({ name: `CancelCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'CancelApp' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

// ---------------------------------------------------------------------------
// Cancel a scheduled campaign
// ---------------------------------------------------------------------------
describe('POST /api/campaigns/:id/cancel', () => {
  it('cancels a scheduled campaign → status becomes canceled', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const [camp] = await db.insert(campaigns).values({
      appId,
      title: 'Scheduled Push',
      body: 'Coming soon',
      targetType: 'all',
      targetValueJsonb: {},
      status: 'scheduled',
      scheduledAt: futureDate,
    }).returning();

    const res = await fetch(`/api/campaigns/${camp.id}/cancel`, { method: 'POST' });

    expect(res.ok).toBe(true);

    const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(updated.status).toBe('canceled');

    // Should have an audit entry
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'campaign_cancel'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('returns 409 when campaign is already queued (not cancelable)', async () => {
    const [camp] = await db.insert(campaigns).values({
      appId,
      title: 'Queued Push',
      body: 'Already queued',
      targetType: 'all',
      targetValueJsonb: {},
      status: 'queued',
    }).returning();

    await expect(
      fetch(`/api/campaigns/${camp.id}/cancel`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Status should remain unchanged
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(row.status).toBe('queued');
  });

  it('returns 409 when campaign is sending', async () => {
    const [camp] = await db.insert(campaigns).values({
      appId,
      title: 'Sending Push',
      body: 'Already sending',
      targetType: 'all',
      targetValueJsonb: {},
      status: 'sending',
    }).returning();

    await expect(
      fetch(`/api/campaigns/${camp.id}/cancel`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns 404 for unknown campaign id', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';

    await expect(
      fetch(`/api/campaigns/${fakeId}/cancel`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 without authentication', async () => {
    const [camp] = await db.insert(campaigns).values({
      appId,
      title: 'Unauthed Push',
      body: 'No auth',
      targetType: 'all',
      targetValueJsonb: {},
      status: 'scheduled',
    }).returning();

    const { default: request } = await import('supertest');
    const res = await request(testApp.nodeListener)
      .post(`/api/campaigns/${camp.id}/cancel`)
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
  });
});
