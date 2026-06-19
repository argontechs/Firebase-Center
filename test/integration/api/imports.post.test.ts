/**
 * Integration test for POST /api/apps/:id/imports (multipart device import).
 * Uses the M1 supertest harness (makeTestApp / resetDb / seedUser / authedFetch).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { companies, apps, imports, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let app: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
let appId: string;

beforeAll(async () => { app = await makeTestApp(); });

beforeEach(async () => {
  await resetDb();
  auth = await seedUser();
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
});

afterAll(async () => { await closeDb(); });

/** Build a supertest multipart POST for device import. */
async function multipartImport(
  csv: string,
  opts: { sessionCookie?: string; csrfCookie?: string; csrfToken?: string; id?: string } = {},
) {
  const { default: request } = await import('supertest');
  const targetId = opts.id ?? appId;
  let req = request(app.nodeListener)
    .post(`/api/apps/${targetId}/imports`)
    .set('Origin', 'http://localhost:3000');

  if (opts.sessionCookie) {
    const cookies = [
      `bo_session=${opts.sessionCookie}`,
      opts.csrfCookie ? `bo_csrf=${opts.csrfCookie}` : '',
    ].filter(Boolean).join('; ');
    req = req.set('Cookie', cookies);
  }
  if (opts.csrfToken) req = req.set('x-csrf-token', opts.csrfToken);

  req = req
    .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'a.csv', contentType: 'text/csv' })
    .field('format', 'csv')
    .field('mapping', JSON.stringify({ token: 'tok', provider: 'prov', platform: 'plat' }));

  return req;
}

/** Log in and retrieve session + CSRF cookies + token. */
async function loginAndGetCsrf() {
  const { default: request } = await import('supertest');
  const loginRes = await request(app.nodeListener)
    .post('/api/auth/login')
    .send({ email: auth.email, password: auth.plaintextPassword })
    .set('Content-Type', 'application/json');

  const extractCookie = (raw: string | string[] | undefined, name: string): string => {
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const cookie of cookies) {
      const first = (cookie.split(';')[0] ?? '').trim();
      if (first.startsWith(`${name}=`)) return first.slice(name.length + 1);
    }
    return '';
  };

  const sessionCookie = extractCookie(loginRes.headers['set-cookie'], 'bo_session');
  const csrfRes = await request(app.nodeListener)
    .get('/api/auth/csrf')
    .set('Cookie', `bo_session=${sessionCookie}`);

  const csrfCookie = extractCookie(csrfRes.headers['set-cookie'], 'bo_csrf');
  const csrfToken: string = (csrfRes.body as { token: string }).token ?? '';

  return { sessionCookie, csrfCookie, csrfToken };
}

describe('POST /api/apps/:id/imports', () => {
  it('imports a CSV, rejects unroutable rows into failed, and audits import_run', async () => {
    const csv = 'tok,prov,plat\nT1,fcm,android\nT2,huawei,android\n';
    const { sessionCookie, csrfCookie, csrfToken } = await loginAndGetCsrf();

    const res = await multipartImport(csv, { sessionCookie, csrfCookie, csrfToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, inserted: 1, updated: 0, failed: 1 });

    const [imp] = await db.select().from(imports).where(eq(imports.id, res.body.importId));
    expect(imp.failed).toBe(1);

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'import_run'));
    expect(audits).toHaveLength(1);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const csv = 'tok\nT1\n';
    const res = await multipartImport(csv);
    expect(res.status).toBe(401);
  });

  it('rejects a missing CSRF token with 403', async () => {
    const csv = 'tok\nT1\n';
    const { sessionCookie, csrfCookie } = await loginAndGetCsrf();
    // Provide session but omit CSRF token.
    const res = await multipartImport(csv, { sessionCookie, csrfCookie });
    expect(res.status).toBe(403);
  });

  it('returns 400 when the mapping field contains malformed JSON', async () => {
    const { default: request } = await import('supertest');
    const { sessionCookie, csrfCookie, csrfToken } = await loginAndGetCsrf();
    const res = await request(app.nodeListener)
      .post(`/api/apps/${appId}/imports`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', [`bo_session=${sessionCookie}`, `bo_csrf=${csrfCookie}`].join('; '))
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from('tok\nT1\n', 'utf-8'), { filename: 'a.csv', contentType: 'text/csv' })
      .field('format', 'csv')
      .field('mapping', '{bad json');
    expect(res.status).toBe(400);
    expect(res.body.statusMessage ?? res.body.message ?? '').toMatch(/mapping must be valid JSON/i);
  });

  it('returns 404 when the target app does not exist', async () => {
    const csv = 'tok,prov,plat\nT1,fcm,android\n';
    const { sessionCookie, csrfCookie, csrfToken } = await loginAndGetCsrf();
    const res = await multipartImport(csv, {
      sessionCookie, csrfCookie, csrfToken,
      id: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
  });
});
