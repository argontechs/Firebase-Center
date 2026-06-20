/**
 * Integration tests for POST /api/v1/messages — programmatic send endpoint (SA.3).
 *
 * Auth: bearer send-key (company-scoped). No CSRF token required — /api/v1/ is
 * CSRF-exempt by the global middleware.  Adapters are mocked via vi.spyOn so
 * no real HTTP is issued.
 *
 * DB: uses the existing makeTestApp / resetDb / db harness.
 */

// Tiny rate-limit so the 429 test is deterministic without 600 real requests.
process.env.SEND_RATE_LIMIT = '5';
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { issueSendKey } from '~~/server/utils/send-keys';
import { resetRateLimits } from '~~/server/utils/rate-limit';
import { companies, apps, devices, campaigns, jobs, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import type supertest from 'supertest';

let testApp: Awaited<ReturnType<typeof makeTestApp>>;

// Fixtures created in beforeEach
let companyId: string;
let appId: string;
let otherCompanyId: string;
let otherAppId: string;
let sendKey: string;

beforeAll(async () => {
  testApp = await makeTestApp();
});

beforeEach(async () => {
  await resetDb();
  resetRateLimits();

  // Company A + its app
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  companyId = c.id;
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'App-A' }).returning();
  appId = a.id;

  // Company B + its app (for cross-site auth check)
  const [c2] = await db.insert(companies).values({ name: 'Rival' }).returning();
  otherCompanyId = c2.id;
  const [a2] = await db.insert(apps).values({ companyId: c2.id, name: 'App-B' }).returning();
  otherAppId = a2.id;

  // Mint a send key for company A
  sendKey = (await issueSendKey(db, companyId, null, 'test-key')).fullKey;

  // Seed one active device so enqueueCampaign creates at least one job
  await db.insert(devices).values({
    appId,
    provider: 'fcm',
    platform: 'android',
    token: 'tok-test-1',
  });
});

afterAll(async () => { await closeDb(); });

/** Low-level POST helper — no session/CSRF, just optional Authorization. */
async function postMessages(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const { default: request } = await import('supertest');
  let req = (request(testApp.nodeListener) as unknown as ReturnType<typeof supertest>)
    .post('/api/v1/messages')
    .set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) {
    req = req.set(k, v);
  }
  return req.send(body);
}

const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages — happy path', () => {
  it('target.all → 202 {campaignId, jobsCreated}, creates campaign row, enqueues job, audits api_send', async () => {
    const res = await postMessages(
      {
        appId,
        target: { type: 'all' },
        notification: { title: 'Hello', body: 'World' },
        data: {},
        mode: 'notification',
        priority: 'high',
      },
      bearer(sendKey),
    );

    expect(res.status).toBe(202);
    expect(res.body.campaignId).toBeTruthy();
    expect(typeof res.body.jobsCreated).toBe('number');

    // Campaign row exists
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, res.body.campaignId));
    expect(camp).toBeDefined();
    expect(camp.appId).toBe(appId);
    expect(camp.title).toBe('Hello');
    expect(camp.status).toBe('queued');
    // createdBy is null for API sends
    expect(camp.createdBy).toBeNull();

    // At least one job enqueued
    const j = await db.select().from(jobs);
    expect(j.length).toBeGreaterThan(0);

    // api_send audited
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'api_send'));
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.targetId).toBe(res.body.campaignId);
    expect((entry.metaJsonb as any).companyId).toBe(companyId);
    expect((entry.metaJsonb as any).appId).toBe(appId);
  });

  it('target.tokens → 202 with jobsCreated (or 0 for unknown ids)', async () => {
    // Use the real device's id
    const [dev] = await db.select().from(devices).where(eq(devices.token, 'tok-test-1'));
    const res = await postMessages(
      {
        appId,
        target: { type: 'tokens', deviceIds: [dev.id] },
        notification: { title: 'T', body: 'B' },
      },
      bearer(sendKey),
    );

    expect(res.status).toBe(202);
    expect(res.body.jobsCreated).toBeGreaterThanOrEqual(0);
  });

  it('does NOT require CSRF token — route is exempt', async () => {
    // Sending without x-csrf-token or bo_csrf cookie must still succeed.
    const res = await postMessages(
      { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
      bearer(sendKey), // only bearer, no CSRF
    );
    expect(res.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Auth failures
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages — auth failures', () => {
  it('missing Authorization header → 401', async () => {
    const res = await postMessages(
      { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
      // no Authorization
    );
    expect(res.status).toBe(401);
  });

  it('unknown bearer token → 401', async () => {
    const res = await postMessages(
      { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
      bearer('bo_sk_totally_unknown'),
    );
    expect(res.status).toBe(401);
  });

  it('revoked send key → 401', async () => {
    // Revoke the key by importing revokeSendKey
    const { revokeSendKey } = await import('~~/server/utils/send-keys');
    // Fetch the key id
    const { siteSendKeys } = await import('~~/server/db/schema');
    const [row] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.companyId, companyId));
    await revokeSendKey(db, companyId, row.id);

    const res = await postMessages(
      { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
      bearer(sendKey),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cross-site isolation
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages — cross-site isolation', () => {
  it('key for company A + appId under company B → 403', async () => {
    const res = await postMessages(
      {
        appId: otherAppId,  // belongs to company B
        target: { type: 'all' },
        notification: { title: 'T', body: 'B' },
      },
      bearer(sendKey), // key is for company A
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages — payload validation', () => {
  it('oversized payload (data > 4 KB) → 400', async () => {
    const res = await postMessages(
      {
        appId,
        target: { type: 'all' },
        notification: { title: 'T', body: 'B' },
        data: { blob: 'x'.repeat(5000) },
      },
      bearer(sendKey),
    );
    expect(res.status).toBe(400);
  });

  it('Huawei click_action type:1 without intent/action → 400', async () => {
    const res = await postMessages(
      {
        appId,
        target: { type: 'all' },
        notification: { title: 'T', body: 'B' },
        data: { click_action: JSON.stringify({ type: 1 }) },
      },
      bearer(sendKey),
    );
    expect(res.status).toBe(400);
  });

  it('missing notification field → 422', async () => {
    const res = await postMessages(
      { appId, target: { type: 'all' } },
      bearer(sendKey),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages — rate limiting', () => {
  it('exceeding SEND_RATE_LIMIT per key → 429', async () => {
    // SEND_RATE_LIMIT = 5 (set at top of file)
    for (let i = 0; i < 5; i++) {
      const r = await postMessages(
        { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
        bearer(sendKey),
      );
      expect(r.status).toBe(202);
    }
    const over = await postMessages(
      { appId, target: { type: 'all' }, notification: { title: 'T', body: 'B' } },
      bearer(sendKey),
    );
    expect(over.status).toBe(429);
  });
});
