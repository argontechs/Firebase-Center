/**
 * D2 integration tests: manual device add + tag edit + delete
 *
 * Routes:
 *   POST   /api/apps/:id/devices/manual   — operator manual add (distinct from bearer ingest)
 *   PATCH  /api/devices/:id               — set tags on a device
 *   DELETE /api/devices/:id               — remove a device
 *
 * All require a valid session (401 without).
 */

process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, devices } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

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

// ---------------------------------------------------------------------------
// POST /api/apps/:id/devices/manual  — auth
// ---------------------------------------------------------------------------
describe('POST /api/apps/:id/devices/manual — auth', () => {
  it('returns 401 without a session', async () => {
    await expect(
      testApp.$fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { token: 'mytoken123456', provider: 'fcm', platform: 'android' },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/apps/:id/devices/manual  — validation
// ---------------------------------------------------------------------------
describe('POST /api/apps/:id/devices/manual — validation', () => {
  it('returns 422 when token is empty', async () => {
    await expect(
      fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { token: '', provider: 'fcm', platform: 'android' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 422 when token is missing', async () => {
    await expect(
      fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { provider: 'fcm', platform: 'android' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 422 when provider is missing', async () => {
    await expect(
      fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { token: 'valid-token-123', platform: 'android' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 422 when platform is missing', async () => {
    await expect(
      fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { token: 'valid-token-123', provider: 'fcm' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/apps/:id/devices/manual  — success
// ---------------------------------------------------------------------------
describe('POST /api/apps/:id/devices/manual — success', () => {
  it('inserts an active device and returns 201 with id', async () => {
    const res = await fetch(`/api/apps/${appId}/devices/manual`, {
      method: 'POST',
      body: {
        token: 'TESTTOKEN_UNIQUE_001',
        provider: 'fcm',
        platform: 'android',
      },
    });
    expect(res.id).toBeTruthy();

    const [d] = await db.select().from(devices).where(eq(devices.id, res.id));
    expect(d).toBeTruthy();
    expect(d!.status).toBe('active');
    expect(d!.appId).toBe(appId);
    expect(d!.provider).toBe('fcm');
    expect(d!.platform).toBe('android');
    expect(d!.token).toBe('TESTTOKEN_UNIQUE_001');
    expect(d!.tags).toEqual([]);
  });

  it('stores optional tags and externalUserId', async () => {
    const res = await fetch(`/api/apps/${appId}/devices/manual`, {
      method: 'POST',
      body: {
        token: 'TESTTOKEN_TAGS_001',
        provider: 'fcm',
        platform: 'android',
        externalUserId: 'user-abc',
        tags: ['vip', 'beta'],
      },
    });
    expect(res.id).toBeTruthy();

    const [d] = await db.select().from(devices).where(eq(devices.id, res.id));
    expect(d!.tags).toEqual(['vip', 'beta']);
    expect(d!.externalUserId).toBe('user-abc');
  });

  it('returns 409 when the (app_id, token) pair already exists', async () => {
    await fetch(`/api/apps/${appId}/devices/manual`, {
      method: 'POST',
      body: { token: 'DUPTOKEN_001', provider: 'fcm', platform: 'android' },
    });

    await expect(
      fetch(`/api/apps/${appId}/devices/manual`, {
        method: 'POST',
        body: { token: 'DUPTOKEN_001', provider: 'fcm', platform: 'android' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/devices/:id  — edit tags
// ---------------------------------------------------------------------------
describe('PATCH /api/devices/:id — auth', () => {
  it('returns 401 without a session', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'PATCHTOK_AUTH',
    }).returning();

    await expect(
      testApp.$fetch(`/api/devices/${d.id}`, {
        method: 'PATCH',
        body: { tags: ['vip'] },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('PATCH /api/devices/:id — set tags', () => {
  it('updates tags on the device', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'PATCHTOK_001',
    }).returning();

    const res = await fetch(`/api/devices/${d.id}`, {
      method: 'PATCH',
      body: { tags: ['new-tag', 'another'] },
    });
    expect(res.id).toBe(d.id);
    expect(res.tags).toEqual(['new-tag', 'another']);

    const [updated] = await db.select().from(devices).where(eq(devices.id, d.id));
    expect(updated!.tags).toEqual(['new-tag', 'another']);
  });

  it('allows setting tags to empty array', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'PATCHTOK_EMPTY',
      tags: ['old'],
    }).returning();

    const res = await fetch(`/api/devices/${d.id}`, {
      method: 'PATCH',
      body: { tags: [] },
    });
    expect(res.tags).toEqual([]);
  });

  it('returns 422 when tags is not an array', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'PATCHTOK_INVALID',
    }).returning();

    await expect(
      fetch(`/api/devices/${d.id}`, {
        method: 'PATCH',
        body: { tags: 'not-an-array' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 404 for a non-existent device id', async () => {
    await expect(
      fetch(`/api/devices/00000000-0000-0000-0000-000000000001`, {
        method: 'PATCH',
        body: { tags: ['vip'] },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/devices/:id — scope check (FIX 3)
// ---------------------------------------------------------------------------
describe('PATCH /api/devices/:id — scope check', () => {
  it('allows patching a device that belongs to app B (different active company)', async () => {
    const [d] = await db.insert(devices).values({
      appId: appBId,
      provider: 'fcm',
      platform: 'android',
      token: 'SCOPE_APPB_PATCH_001',
    }).returning();

    const res = await fetch(`/api/devices/${d.id}`, {
      method: 'PATCH',
      body: { tags: ['patched'] },
    });
    expect(res.tags).toEqual(['patched']);
  });

  it('returns 404 when the device company is archived (not visible) on PATCH', async () => {
    const { companies: companiesTable, apps: appsTable } = await import('~~/server/db/schema');
    const { eq: eqOp } = await import('drizzle-orm');

    const [d] = await db.insert(devices).values({
      appId: appBId,
      provider: 'fcm',
      platform: 'android',
      token: 'SCOPE_PATCH_ARCHIVED_001',
    }).returning();

    // Archive app B's company.
    const [appB] = await db.select({ companyId: appsTable.companyId }).from(appsTable).where(eqOp(appsTable.id, appBId));
    await db.update(companiesTable).set({ status: 'archived' }).where(eqOp(companiesTable.id, appB!.companyId));

    await expect(
      fetch(`/api/devices/${d.id}`, {
        method: 'PATCH',
        body: { tags: ['blocked'] },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // Tags must not have changed.
    const [after] = await db.select().from(devices).where(eqOp(devices.id, d.id));
    expect(after!.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/devices/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/devices/:id — auth', () => {
  it('returns 401 without a session', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'DELTOK_AUTH',
    }).returning();

    await expect(
      testApp.$fetch(`/api/devices/${d.id}`, { method: 'DELETE' }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('DELETE /api/devices/:id — success', () => {
  it('removes the device and returns 204', async () => {
    const [d] = await db.insert(devices).values({
      appId,
      provider: 'fcm',
      platform: 'android',
      token: 'DELTOK_001',
    }).returning();

    const res = await fetch(`/api/devices/${d.id}`, { method: 'DELETE' });
    expect(res).toBeUndefined(); // 204 No Content

    const rows = await db.select().from(devices).where(eq(devices.id, d.id));
    expect(rows).toHaveLength(0);
  });

  it('returns 404 for a non-existent device id', async () => {
    await expect(
      fetch(`/api/devices/00000000-0000-0000-0000-000000000002`, { method: 'DELETE' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/devices/:id — scope check (D2 Step 3)
//
// Under the flat-RBAC model every operator can see all active companies, so a
// device belonging to app B (a different company) is still deletable. The scope
// check must reject devices whose company is archived (not visible).
// ---------------------------------------------------------------------------
describe('DELETE /api/devices/:id — scope check', () => {
  it('allows deleting a device that belongs to app B (different active company)', async () => {
    const [d] = await db.insert(devices).values({
      appId: appBId,
      provider: 'fcm',
      platform: 'android',
      token: 'SCOPE_APPB_DEL_001',
    }).returning();

    // Flat-RBAC: operator can delete any device whose company is active.
    const res = await fetch(`/api/devices/${d.id}`, { method: 'DELETE' });
    expect(res).toBeUndefined(); // 204 No Content

    const rows = await db.select().from(devices).where(eq(devices.id, d.id));
    expect(rows).toHaveLength(0);
  });

  it('returns 404 when the device company is archived (not visible)', async () => {
    const { companies: companiesTable } = await import('~~/server/db/schema');
    const { eq: eqOp } = await import('drizzle-orm');

    // Seed a device under app B, then archive app B's company.
    const [d] = await db.insert(devices).values({
      appId: appBId,
      provider: 'fcm',
      platform: 'android',
      token: 'SCOPE_ARCHIVED_001',
    }).returning();

    // Retrieve app B's company id so we can archive it.
    const { apps: appsTable } = await import('~~/server/db/schema');
    const [appB] = await db.select({ companyId: appsTable.companyId }).from(appsTable).where(eqOp(appsTable.id, appBId));
    await db.update(companiesTable).set({ status: 'archived' }).where(eqOp(companiesTable.id, appB!.companyId));

    // Scope check must block: company no longer visible.
    await expect(
      fetch(`/api/devices/${d.id}`, { method: 'DELETE' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // Device must still exist (not deleted).
    const rows = await db.select().from(devices).where(eqOp(devices.id, d.id));
    expect(rows).toHaveLength(1);
  });
});
