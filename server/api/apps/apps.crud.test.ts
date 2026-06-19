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

async function makeCompany() {
  return fetch('/api/companies', { method: 'POST', body: { name: 'Acme Corp' } });
}

describe('app CRUD scoped to company', () => {
  it('rejects unauthenticated list with 401', async () => {
    await expect(app.$fetch('/api/apps?companyId=' + '00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects list without companyId with 422', async () => {
    await expect(fetch('/api/apps')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('creates, lists by company, reads, patches, deletes', async () => {
    const company = await makeCompany();

    const created = await fetch('/api/apps', { method: 'POST', body: { companyId: company.id, name: 'Acme Shopper' } });
    expect(created).toMatchObject({ companyId: company.id, name: 'Acme Shopper' });

    const list = await fetch(`/api/apps?companyId=${company.id}`);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const read = await fetch(`/api/apps/${created.id}`);
    expect(read.name).toBe('Acme Shopper');

    const patched = await fetch(`/api/apps/${created.id}`, { method: 'PATCH', body: { name: 'Acme Rider' } });
    expect(patched.name).toBe('Acme Rider');

    const del = await fetch(`/api/apps/${created.id}`, { method: 'DELETE' });
    expect(del).toBeUndefined();
    await expect(fetch(`/api/apps/${created.id}`)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects creating an app under a non-existent company with 404', async () => {
    await expect(
      fetch('/api/apps', { method: 'POST', body: { companyId: '00000000-0000-0000-0000-000000000000', name: 'Orphan' } }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects POST without CSRF with 403', async () => {
    const company = await makeCompany();
    // Issue raw request with session cookie but no CSRF token/header.
    const { default: request } = await import('supertest');
    const loginRes = await request(app.nodeListener)
      .post('/api/auth/login')
      .send({ email: auth.email, password: auth.plaintextPassword })
      .set('Content-Type', 'application/json');
    const setCookieHeader: string | string[] = loginRes.headers['set-cookie'] ?? '';
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionVal = cookies.map((c: string) => c.split(';')[0]).find((p: string) => p.startsWith('bo_session=')) ?? '';
    const res = await request(app.nodeListener)
      .post('/api/apps')
      .set('Cookie', sessionVal)
      .set('Origin', 'http://localhost:3000')
      .send({ companyId: company.id, name: 'X' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
  });

  it('does not list apps from a different company', async () => {
    const a = await makeCompany();
    const b = await fetch('/api/companies', { method: 'POST', body: { name: 'Globex' } });
    await fetch('/api/apps', { method: 'POST', body: { companyId: a.id, name: 'A1' } });
    const listB = await fetch(`/api/apps?companyId=${b.id}`);
    expect(listB).toHaveLength(0);
  });
});
