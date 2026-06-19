/**
 * Integration test for ingest-key management routes:
 *   POST   /api/apps/:id/ingest-keys          (issue)
 *   GET    /api/apps/:id/ingest-keys          (list metadata)
 *   POST   /api/apps/:id/ingest-keys/:kid/rotate
 *   POST   /api/apps/:id/ingest-keys/:kid/revoke
 *
 * Uses the M1 supertest harness (makeTestApp / resetDb / seedUser / authedFetch).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let app: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;
let appId: string;

beforeAll(async () => { app = await makeTestApp(); });

beforeEach(async () => {
  await resetDb();
  auth = await seedUser();
  fetch = authedFetch(app.nodeListener, auth);
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

it('issues a key (shown once), audits ingest_key_issue, then GET returns metadata only', async () => {
  const issued = await fetch(`/api/apps/${appId}/ingest-keys`, { method: 'POST', body: { label: 'mobile' } });
  expect(issued.key).toMatch(/^bo_ik_/);
  const list = await fetch(`/api/apps/${appId}/ingest-keys`);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ version: 1, label: 'mobile', revokedAt: null });
  expect(list[0].keyPrefix).toMatch(/^bo_ik_/);
  // full key must never be re-served
  expect(JSON.stringify(list[0])).not.toContain(issued.key);
  expect(list[0].keyHash).toBeUndefined();
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'ingest_key_issue'));
  expect(audits).toHaveLength(1);
});

it('rotate returns a new key, audits as ingest_key_issue (no distinct rotate action), and yields a v2 active row', async () => {
  const first = await fetch(`/api/apps/${appId}/ingest-keys`, { method: 'POST', body: {} });
  const list = await fetch(`/api/apps/${appId}/ingest-keys`);
  const rotated = await fetch(`/api/apps/${appId}/ingest-keys/${list[0].id}/rotate`, { method: 'POST' });
  expect(rotated.key).not.toBe(first.key);
  const after = await fetch(`/api/apps/${appId}/ingest-keys`);
  expect(after.find((k: any) => k.version === 2 && k.revokedAt === null)).toBeTruthy();
  // issue + rotate both audit as ingest_key_issue; there is no ingest_key_rotate in the taxonomy
  const issueAudits = await db.select().from(auditLog).where(eq(auditLog.action, 'ingest_key_issue'));
  expect(issueAudits).toHaveLength(2);
});

it('revoke returns 204 and audits ingest_key_revoke', async () => {
  await fetch(`/api/apps/${appId}/ingest-keys`, { method: 'POST', body: {} });
  const list = await fetch(`/api/apps/${appId}/ingest-keys`);
  // Use supertest directly to capture the 204 status code
  const { default: request } = await import('supertest');
  const { default: request2 } = await import('supertest');

  // Login to get cookies + CSRF for direct supertest call
  const loginRes = await request(app.nodeListener)
    .post('/api/auth/login')
    .send({ email: auth.email, password: auth.plaintextPassword })
    .set('Content-Type', 'application/json');

  const sessionCookieRaw = loginRes.headers['set-cookie'];
  const cookieArr = Array.isArray(sessionCookieRaw) ? sessionCookieRaw : sessionCookieRaw ? [sessionCookieRaw] : [];
  const sessionCookie = cookieArr.find((c: string) => c.startsWith('bo_session='))?.split(';')[0].split('=')[1] ?? '';

  const csrfRes = await request(app.nodeListener)
    .get('/api/auth/csrf')
    .set('Cookie', `bo_session=${sessionCookie}`);

  const csrfCookieRaw = csrfRes.headers['set-cookie'];
  const csrfArr = Array.isArray(csrfCookieRaw) ? csrfCookieRaw : csrfCookieRaw ? [csrfCookieRaw] : [];
  const csrfCookie = csrfArr.find((c: string) => c.startsWith('bo_csrf='))?.split(';')[0].split('=')[1] ?? '';
  const csrfToken: string = (csrfRes.body as { token: string }).token ?? '';

  const res = await request(app.nodeListener)
    .post(`/api/apps/${appId}/ingest-keys/${list[0].id}/revoke`)
    .set('Cookie', `bo_session=${sessionCookie}; bo_csrf=${csrfCookie}`)
    .set('x-csrf-token', csrfToken)
    .set('Origin', 'http://localhost:3000');

  expect(res.status).toBe(204);
  const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'ingest_key_revoke'));
  expect(audits).toHaveLength(1);
});

it('rejects issue without CSRF (403)', async () => {
  const { default: request } = await import('supertest');

  // Login to get session cookie (but no CSRF)
  const loginRes = await request(app.nodeListener)
    .post('/api/auth/login')
    .send({ email: auth.email, password: auth.plaintextPassword })
    .set('Content-Type', 'application/json');

  const sessionCookieRaw = loginRes.headers['set-cookie'];
  const cookieArr = Array.isArray(sessionCookieRaw) ? sessionCookieRaw : sessionCookieRaw ? [sessionCookieRaw] : [];
  const sessionCookie = cookieArr.find((c: string) => c.startsWith('bo_session='))?.split(';')[0].split('=')[1] ?? '';

  const res = await request(app.nodeListener)
    .post(`/api/apps/${appId}/ingest-keys`)
    .send({})
    .set('Content-Type', 'application/json')
    .set('Cookie', `bo_session=${sessionCookie}`)
    .set('Origin', 'http://localhost:3000');
  // no x-csrf-token → assertCsrf throws 403

  expect(res.status).toBe(403);
});
