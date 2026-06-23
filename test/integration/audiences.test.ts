process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

/**
 * C1 integration tests: Audiences CRUD API
 *
 * Routes under test:
 *   GET    /api/apps/:id/audiences         — list with live count
 *   POST   /api/apps/:id/audiences         — create (422 missing name; 409 duplicate)
 *   PATCH  /api/apps/:id/audiences/:aid    — update filter
 *   DELETE /api/apps/:id/audiences/:aid    — remove
 *
 * Auth: real operator session + CSRF via makeTestApp / seedUser / authedFetch.
 * Tenant isolation: an audience under app B is NOT visible/editable via app A.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, audiences, devices } from '~~/server/db/schema';

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
  auth = await seedUser({ role: 'admin' });
  fetch = authedFetch(testApp.nodeListener, auth);

  const [c] = await db.insert(companies).values({ name: `Co-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'AppA' }).returning();
  appId = a.id;

  const [c2] = await db.insert(companies).values({ name: `Co2-${Math.random().toString(36).slice(2)}` }).returning();
  const [a2] = await db.insert(apps).values({ companyId: c2.id, name: 'AppB' }).returning();
  appBId = a2.id;
});

afterAll(async () => { await closeDb(); });

// ---------------------------------------------------------------------------
// POST /api/apps/:id/audiences
// ---------------------------------------------------------------------------
describe('POST /api/apps/:id/audiences', () => {
  it('creates an audience and returns it', async () => {
    const res = await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'VIP Android', platform: 'android', tag: 'vip' },
    });
    expect(res.id).toBeTruthy();
    expect(res.name).toBe('VIP Android');
    expect(res.platform).toBe('android');
    expect(res.tag).toBe('vip');
    expect(res.appId).toBe(appId);
    expect(typeof res.count).toBe('number');
  });

  it('returns 422 when name is missing', async () => {
    await expect(fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { platform: 'android' },
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 409 on duplicate name within the same app', async () => {
    await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'DupName' },
    });
    await expect(fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'DupName' },
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows the same name across different apps', async () => {
    await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'SharedName' },
    });
    const res = await fetch(`/api/apps/${appBId}/audiences`, {
      method: 'POST',
      body: { name: 'SharedName' },
    });
    expect(res.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/apps/:id/audiences
// ---------------------------------------------------------------------------
describe('GET /api/apps/:id/audiences', () => {
  it('lists audiences for an app with live count', async () => {
    // Seed an active device with tag 'vip'
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok1', tags: ['vip'] });
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'ios', token: 'tok2' });

    // Create two audiences
    await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'VIP Users', tag: 'vip' },
    });
    await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'All Devices' },
    });

    const res = await fetch(`/api/apps/${appId}/audiences`);
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(2);

    const vip = res.find((a: any) => a.name === 'VIP Users');
    const all = res.find((a: any) => a.name === 'All Devices');
    expect(vip).toBeDefined();
    expect(vip.count).toBe(1); // only the device with 'vip' tag
    expect(all.count).toBe(2); // both active devices
  });

  it('does not return audiences from other apps (tenant isolation)', async () => {
    await fetch(`/api/apps/${appBId}/audiences`, {
      method: 'POST',
      body: { name: 'App B Audience' },
    });

    const res = await fetch(`/api/apps/${appId}/audiences`);
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(0);
  });

  it('returns 401 without a session', async () => {
    await expect(testApp.$fetch(`/api/apps/${appId}/audiences`)).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/apps/:id/audiences/:aid
// ---------------------------------------------------------------------------
describe('PATCH /api/apps/:id/audiences/:aid', () => {
  it('updates the audience filter and returns updated row with new count', async () => {
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 'tok_a', tags: ['vip'] });
    await db.insert(devices).values({ appId, provider: 'fcm', platform: 'ios', token: 'tok_b' });

    const created = await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'My Audience' },
    });
    // Initially no filter → count = 2
    expect(created.count).toBe(2);

    const updated = await fetch(`/api/apps/${appId}/audiences/${created.id}`, {
      method: 'PATCH',
      body: { tag: 'vip' },
    });
    expect(updated.tag).toBe('vip');
    expect(updated.count).toBe(1);
  });

  it('returns 404 for an audience belonging to another app', async () => {
    const audienceB = await fetch(`/api/apps/${appBId}/audiences`, {
      method: 'POST',
      body: { name: 'B Audience' },
    });

    await expect(fetch(`/api/apps/${appId}/audiences/${audienceB.id}`, {
      method: 'PATCH',
      body: { tag: 'x' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/apps/:id/audiences/:aid
// ---------------------------------------------------------------------------
describe('DELETE /api/apps/:id/audiences/:aid', () => {
  it('removes the audience', async () => {
    const created = await fetch(`/api/apps/${appId}/audiences`, {
      method: 'POST',
      body: { name: 'ToDelete' },
    });

    await fetch(`/api/apps/${appId}/audiences/${created.id}`, { method: 'DELETE' });

    const list = await fetch(`/api/apps/${appId}/audiences`);
    expect(list).toHaveLength(0);
  });

  it('returns 404 for an audience belonging to another app', async () => {
    const audienceB = await fetch(`/api/apps/${appBId}/audiences`, {
      method: 'POST',
      body: { name: 'B Audience' },
    });

    await expect(fetch(`/api/apps/${appId}/audiences/${audienceB.id}`, {
      method: 'DELETE',
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
