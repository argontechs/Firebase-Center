/**
 * send-keys.test.ts
 *
 * Integration tests for SA.2: send-key management routes
 * (POST /api/companies/:id/send-keys, GET /api/companies/:id/send-keys,
 *  POST /api/companies/:id/send-keys/:kid/revoke,
 *  POST /api/companies/:id/send-keys/:kid/rotate).
 *
 * Requires the full test DB (NUXT_DATABASE_URL) with migrations applied.
 * Uses the existing makeTestApp() harness.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';

let app: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;

beforeAll(async () => { app = await makeTestApp(); });
beforeEach(async () => {
  await resetDb();
  auth = await seedUser();
  fetch = authedFetch(app.nodeListener, auth);
});
afterAll(async () => { await closeDb(); });

// Helper: seed a company through the API (authenticated).
async function makeCompany(name = 'Test Corp') {
  return fetch('/api/companies', { method: 'POST', body: { name } });
}

// ---------------------------------------------------------------------------
// POST /api/companies/:id/send-keys  (issue)
// ---------------------------------------------------------------------------
describe('POST /api/companies/:id/send-keys (issue)', () => {
  it('returns id, fullKey (bo_sk_-prefixed), keyPrefix, version=1 on issue', async () => {
    const company = await makeCompany();
    const res = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: { label: 'primary' } });
    expect(res.id).toBeTruthy();
    expect(res.fullKey).toMatch(/^bo_sk_/);
    expect(res.keyPrefix).toHaveLength(12);
    expect(res.version).toBe(1);
  });

  it('fullKey is never returned again (show-once)', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    const list = await fetch(`/api/companies/${company.id}/send-keys`);
    // List should not contain the fullKey or keyHash
    expect(list[0]).not.toHaveProperty('fullKey');
    expect(list[0]).not.toHaveProperty('keyHash');
    expect(list[0].id).toBe(issued.id);
  });

  it('audits send_key_issue', async () => {
    const { db: testDb } = await import('~~/server/test/db');
    const { auditLog } = await import('~~/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const company = await makeCompany();
    await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    const rows = await testDb.select().from(auditLog).where(eq(auditLog.action, 'send_key_issue'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].targetType).toBe('company');
    expect(rows[0].targetId).toBe(company.id);
  });

  it('returns 404 for a non-existent company', async () => {
    await expect(
      fetch('/api/companies/00000000-0000-0000-0000-000000000000/send-keys', { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const company = await makeCompany();
    await expect(
      app.$fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 when CSRF token is missing', async () => {
    const company = await makeCompany();
    const { default: request } = await import('supertest');
    const loginRes = await request(app.nodeListener)
      .post('/api/auth/login')
      .send({ email: auth.email, password: auth.plaintextPassword })
      .set('Content-Type', 'application/json');
    const setCookieHeader: string | string[] = loginRes.headers['set-cookie'] ?? '';
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionVal = cookies.map((c: string) => c.split(';')[0]).find((p: string) => p.startsWith('bo_session=')) ?? '';
    const res = await request(app.nodeListener)
      .post(`/api/companies/${company.id}/send-keys`)
      .set('Cookie', sessionVal)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/companies/:id/send-keys  (list)
// ---------------------------------------------------------------------------
describe('GET /api/companies/:id/send-keys (list)', () => {
  it('returns metadata only — never fullKey or keyHash', async () => {
    const company = await makeCompany();
    await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: { label: 'k1' } });
    const list = await fetch(`/api/companies/${company.id}/send-keys`);
    expect(list).toHaveLength(1);
    const row = list[0];
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('keyPrefix');
    expect(row).toHaveProperty('version');
    expect(row).toHaveProperty('label');
    expect(row).toHaveProperty('createdAt');
    expect(row).toHaveProperty('revokedAt');
    expect(row).not.toHaveProperty('fullKey');
    expect(row).not.toHaveProperty('keyHash');
  });

  it('lists multiple keys for a company', async () => {
    const company = await makeCompany();
    await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: { label: 'a' } });
    await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: { label: 'b' } });
    const list = await fetch(`/api/companies/${company.id}/send-keys`);
    expect(list).toHaveLength(2);
  });

  it('returns 404 for a non-existent company', async () => {
    await expect(
      fetch('/api/companies/00000000-0000-0000-0000-000000000000/send-keys'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const company = await makeCompany();
    await expect(
      app.$fetch(`/api/companies/${company.id}/send-keys`),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/companies/:id/send-keys/:kid/revoke
// ---------------------------------------------------------------------------
describe('POST /api/companies/:id/send-keys/:kid/revoke', () => {
  it('revokes an active key (204 no content) and audits send_key_revoke', async () => {
    const { db: testDb } = await import('~~/server/test/db');
    const { auditLog, siteSendKeys } = await import('~~/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    const result = await fetch(`/api/companies/${company.id}/send-keys/${issued.id}/revoke`, { method: 'POST' });
    // 204 → fetch helper returns undefined
    expect(result).toBeUndefined();

    // The key should now have revokedAt set
    const [row] = await testDb.select().from(siteSendKeys).where(eq(siteSendKeys.id, issued.id));
    expect(row.revokedAt).not.toBeNull();

    // Audit entry recorded
    const auditRows = await testDb.select().from(auditLog).where(eq(auditLog.action, 'send_key_revoke'));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].targetType).toBe('company');
    expect(auditRows[0].targetId).toBe(company.id);
  });

  it('returns 404 for a non-existent key', async () => {
    const company = await makeCompany();
    await expect(
      fetch(`/api/companies/${company.id}/send-keys/00000000-0000-0000-0000-000000000000/revoke`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a non-existent company', async () => {
    await expect(
      fetch('/api/companies/00000000-0000-0000-0000-000000000000/send-keys/00000000-0000-0000-0000-000000000000/revoke', { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    await expect(
      app.$fetch(`/api/companies/${company.id}/send-keys/${issued.id}/revoke`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 when CSRF token is missing', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    const { default: request } = await import('supertest');
    const loginRes = await request(app.nodeListener)
      .post('/api/auth/login')
      .send({ email: auth.email, password: auth.plaintextPassword })
      .set('Content-Type', 'application/json');
    const setCookieHeader: string | string[] = loginRes.headers['set-cookie'] ?? '';
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionVal = cookies.map((c: string) => c.split(';')[0]).find((p: string) => p.startsWith('bo_session=')) ?? '';
    const res = await request(app.nodeListener)
      .post(`/api/companies/${company.id}/send-keys/${issued.id}/revoke`)
      .set('Cookie', sessionVal)
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/companies/:id/send-keys/:kid/rotate
// ---------------------------------------------------------------------------
describe('POST /api/companies/:id/send-keys/:kid/rotate', () => {
  it('rotates a key: returns new fullKey + version+1, revokes old key, audits send_key_rotate', async () => {
    const { db: testDb } = await import('~~/server/test/db');
    const { auditLog, siteSendKeys } = await import('~~/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: { label: 'v1' } });
    const rotated = await fetch(`/api/companies/${company.id}/send-keys/${issued.id}/rotate`, { method: 'POST' });

    expect(rotated.fullKey).toMatch(/^bo_sk_/);
    expect(rotated.version).toBe(2);
    expect(rotated.id).not.toBe(issued.id);

    // Old key should be revoked
    const [old] = await testDb.select().from(siteSendKeys).where(eq(siteSendKeys.id, issued.id));
    expect(old.revokedAt).not.toBeNull();

    // Audit entry for send_key_rotate
    const auditRows = await testDb.select().from(auditLog).where(eq(auditLog.action, 'send_key_rotate'));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].targetType).toBe('company');
    expect(auditRows[0].targetId).toBe(company.id);
    expect((auditRows[0].metaJsonb as any).rotatedFrom).toBe(issued.id);
  });

  it('returns 404 for a non-existent key', async () => {
    const company = await makeCompany();
    await expect(
      fetch(`/api/companies/${company.id}/send-keys/00000000-0000-0000-0000-000000000000/rotate`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 when rotating an already-revoked key', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    await fetch(`/api/companies/${company.id}/send-keys/${issued.id}/revoke`, { method: 'POST' });
    await expect(
      fetch(`/api/companies/${company.id}/send-keys/${issued.id}/rotate`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a non-existent company', async () => {
    await expect(
      fetch('/api/companies/00000000-0000-0000-0000-000000000000/send-keys/00000000-0000-0000-0000-000000000000/rotate', { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    await expect(
      app.$fetch(`/api/companies/${company.id}/send-keys/${issued.id}/rotate`, { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 when CSRF token is missing', async () => {
    const company = await makeCompany();
    const issued = await fetch(`/api/companies/${company.id}/send-keys`, { method: 'POST', body: {} });
    const { default: request } = await import('supertest');
    const loginRes = await request(app.nodeListener)
      .post('/api/auth/login')
      .send({ email: auth.email, password: auth.plaintextPassword })
      .set('Content-Type', 'application/json');
    const setCookieHeader: string | string[] = loginRes.headers['set-cookie'] ?? '';
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionVal = cookies.map((c: string) => c.split(';')[0]).find((p: string) => p.startsWith('bo_session=')) ?? '';
    const res = await request(app.nodeListener)
      .post(`/api/companies/${company.id}/send-keys/${issued.id}/rotate`)
      .set('Cookie', sessionVal)
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
  });
});
