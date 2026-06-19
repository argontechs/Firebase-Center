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

describe('company CRUD', () => {
  it('rejects unauthenticated list with 401', async () => {
    await expect(app.$fetch('/api/companies')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('creates, lists, reads, patches, and deletes a company', async () => {
    const created = await fetch('/api/companies', { method: 'POST', body: { name: 'Acme Corp', notes: 'vip' } });
    expect(created).toMatchObject({ name: 'Acme Corp', notes: 'vip', status: 'active' });
    expect(created.id).toBeTruthy();

    const list = await fetch('/api/companies');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const read = await fetch(`/api/companies/${created.id}`);
    expect(read.name).toBe('Acme Corp');

    const patched = await fetch(`/api/companies/${created.id}`, { method: 'PATCH', body: { name: 'Acme Inc', status: 'archived' } });
    expect(patched).toMatchObject({ name: 'Acme Inc', status: 'archived' });

    const del = await fetch(`/api/companies/${created.id}`, { method: 'DELETE' });
    expect(del).toBeUndefined();
    await expect(fetch(`/api/companies/${created.id}`)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects POST without a CSRF token with 403', async () => {
    // Issue raw request with session cookie but no CSRF token/header.
    const { default: request } = await import('supertest');
    const loginRes = await request(app.nodeListener)
      .post('/api/auth/login')
      .send({ email: auth.email, password: auth.plaintextPassword })
      .set('Content-Type', 'application/json');
    const setCookieHeader: string | string[] = loginRes.headers['set-cookie'] ?? '';
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionVal = cookies.map((c) => c.split(';')[0]).find((p) => p.startsWith('bo_session=')) ?? '';
    const res = await request(app.nodeListener)
      .post('/api/companies')
      .set('Cookie', sessionVal)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'X' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
  });

  it('rejects POST with a missing name with 422', async () => {
    await expect(fetch('/api/companies', { method: 'POST', body: {} })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 404 reading a non-existent company', async () => {
    await expect(fetch('/api/companies/00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ statusCode: 404 });
  });
});
