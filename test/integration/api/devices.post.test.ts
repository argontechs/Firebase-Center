/**
 * Integration test for POST /api/apps/:id/devices (bearer ingest-key registration).
 * Uses the M1 supertest harness (makeTestApp / resetDb / seedUser).
 *
 * The route is bearer-key authenticated (no session/CSRF required).
 */

// Set a tiny rate-limit threshold so the 429 test is deterministic.
process.env.INGEST_RATE_LIMIT = '5';
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { issueIngestKey } from '~~/server/utils/ingest-keys';
import { resetRateLimits } from '~~/server/utils/rate-limit';
import { companies, apps, devices } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import type supertest from 'supertest';

let app: Awaited<ReturnType<typeof makeTestApp>>;
let appId: string;
let otherAppId: string;
let key: string;

beforeAll(async () => { app = await makeTestApp(); });

beforeEach(async () => {
  await resetDb();
  resetRateLimits();  // isolate per-key/per-IP windows between tests
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  const [b] = await db.insert(apps).values({ companyId: c.id, name: 'B' }).returning();
  appId = a.id;
  otherAppId = b.id;
  key = (await issueIngestKey(db, appId, null)).fullKey;
});

afterAll(async () => { await closeDb(); });

/** Helper: POST to the devices endpoint via supertest. */
async function postDevice(
  targetAppId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const { default: request } = await import('supertest');
  let req = (request(app.nodeListener) as unknown as ReturnType<typeof supertest>)
    .post(`/api/apps/${targetAppId}/devices`)
    .set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) {
    req = req.set(k, v);
  }
  return req.send(body);
}

const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

describe('POST /api/apps/:id/devices', () => {
  it('registers a token with a valid key and returns 201 { id }', async () => {
    const res = await postDevice(
      appId,
      { token: 'TOK1', provider: 'fcm', platform: 'android', external_user_id: 'u1' },
      bearer(key),
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();

    const [d] = await db.select().from(devices).where(eq(devices.token, 'TOK1'));
    expect(d.appId).toBe(appId);
    expect(d.externalUserId).toBe('u1');
  });

  it('rejects a missing bearer key with 401', async () => {
    const res = await postDevice(
      appId,
      { token: 'X', provider: 'fcm', platform: 'android' },
      // no Authorization header
    );
    expect(res.status).toBe(401);
  });

  it('rejects an invalid bearer key with 401', async () => {
    const res = await postDevice(
      appId,
      { token: 'X', provider: 'fcm', platform: 'android' },
      bearer('bo_ik_nope'),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a key bound to another app with 403', async () => {
    const res = await postDevice(
      otherAppId,
      { token: 'X', provider: 'fcm', platform: 'android' },
      bearer(key),
    );
    expect(res.status).toBe(403);
  });

  it('whitelists fields — extra keys are dropped, not persisted', async () => {
    await postDevice(
      appId,
      {
        token: 'TOK2',
        provider: 'fcm',
        platform: 'android',
        status: 'invalid',         // should be ignored (route always sets active)
        appId: otherAppId,          // should be ignored (route param wins)
        attributes_jsonb: { x: 1 },// should be ignored (not whitelisted)
      },
      bearer(key),
    );
    const [d] = await db.select().from(devices).where(eq(devices.token, 'TOK2'));
    expect(d).toBeDefined();
    expect(d.appId).toBe(appId);         // route param wins, not body
    expect(d.status).toBe('active');     // body status ignored
    expect(d.attributesJsonb).toEqual({});
  });

  it('rejects an unroutable row (huawei provider + android platform) with 422', async () => {
    const res = await postDevice(
      appId,
      { token: 'X', provider: 'huawei', platform: 'android' },
      bearer(key),
    );
    expect(res.status).toBe(422);
  });

  it('rate-limits after the per-key threshold with 429', async () => {
    // INGEST_RATE_LIMIT = 5 (set at top of file)
    for (let i = 0; i < 5; i++) {
      const r = await postDevice(
        appId,
        { token: `t${i}`, provider: 'fcm', platform: 'android' },
        bearer(key),
      );
      expect(r.status).toBe(201);
    }
    const over = await postDevice(
      appId,
      { token: 't-over', provider: 'fcm', platform: 'android' },
      bearer(key),
    );
    expect(over.status).toBe(429);
  });
});
