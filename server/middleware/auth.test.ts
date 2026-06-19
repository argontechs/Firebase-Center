import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db, truncate, closeDb } from '~/server/test/db';
import { seedUser } from '~/server/test/auth';
import { createSession } from '~/server/utils/auth/session';

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ allowedOrigins: ['https://bo.example.com'] }) }), { virtual: true });
vi.mock('h3', () => ({
  getCookie: (e: any, n: string) => e._cookies?.[n],
  getRequestHeader: (e: any, h: string) => e._headers?.[h.toLowerCase()],
  getMethod: (e: any) => e._method ?? 'GET',
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
  defineEventHandler: (fn: any) => fn,
}));

import guard from './auth';

function evt(o: { path: string; method?: string; cookies?: any; headers?: any } ) {
  return { path: o.path, _method: o.method ?? 'GET', _cookies: o.cookies ?? {}, _headers: o.headers ?? {}, context: {} as any, node: { req: { url: o.path } } } as any;
}
async function seed() {
  const { id: uid } = await seedUser();
  const { sessionId } = await createSession(uid);
  return { uid, sessionId };
}
beforeEach(async () => { await truncate('sessions', 'users'); });
afterAll(async () => { await closeDb(); });

describe('server auth guard', () => {
  it('lets the public login route through with no session', async () => {
    await expect(guard(evt({ path: '/api/auth/login', method: 'POST' }))).resolves.toBeUndefined();
  });

  it('lets the csrf-mint route through with no session', async () => {
    await expect(guard(evt({ path: '/api/auth/csrf' }))).resolves.toBeUndefined();
  });

  it('lets /healthz through', async () => {
    await expect(guard(evt({ path: '/healthz' }))).resolves.toBeUndefined();
  });

  it('401s an authed GET with no session', async () => {
    await expect(guard(evt({ path: '/api/companies' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('attaches the user on a valid session GET', async () => {
    const { uid, sessionId } = await seed();
    const e = evt({ path: '/api/companies', cookies: { bo_session: sessionId } });
    await guard(e);
    expect(e.context.user.id).toBe(uid);
  });

  it('403s a POST when CSRF double-submit is missing', async () => {
    const { sessionId } = await seed();
    const e = evt({ path: '/api/companies', method: 'POST', cookies: { bo_session: sessionId }, headers: { origin: 'https://bo.example.com' } });
    await expect(guard(e)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('403s a POST when origin is foreign even with matching tokens', async () => {
    const { sessionId } = await seed();
    const e = evt({ path: '/api/companies', method: 'POST', cookies: { bo_session: sessionId, bo_csrf: 'tok' }, headers: { origin: 'https://evil.com', 'x-csrf-token': 'tok' } });
    await expect(guard(e)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('passes a POST with matching CSRF + allowed origin', async () => {
    const { uid, sessionId } = await seed();
    const e = evt({ path: '/api/companies', method: 'POST', cookies: { bo_session: sessionId, bo_csrf: 'tok' }, headers: { origin: 'https://bo.example.com', 'x-csrf-token': 'tok' } });
    await guard(e);
    expect(e.context.user.id).toBe(uid);
  });

  it('exempts the bearer-auth app-ingest device route from session + CSRF', async () => {
    await expect(guard(evt({ path: '/api/apps/abc/devices', method: 'POST', headers: { authorization: 'Bearer k' } }))).resolves.toBeUndefined();
  });

  it('exempts the forced change-password route from CSRF (session-guarded only)', async () => {
    const { sessionId } = await seed();
    const e = evt({ path: '/api/auth/change-password', method: 'POST', cookies: { bo_session: sessionId }, headers: { origin: 'https://bo.example.com' } });
    await guard(e);                       // no CSRF token, but must not 403
    expect(e.context.user).toBeDefined();
  });

  // Finding: mustChangePassword enforcement (M1.10 code-review)
  it('403s a state-changing POST when mustChangePassword=true (bypass gate)', async () => {
    const { id: uid } = await seedUser({ mustChangePassword: true });
    const { sessionId } = await createSession(uid);
    const e = evt({ path: '/api/companies', method: 'POST', cookies: { bo_session: sessionId, bo_csrf: 'tok' }, headers: { origin: 'https://bo.example.com', 'x-csrf-token': 'tok' } });
    await expect(guard(e)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows GET through when mustChangePassword=true (reads still permitted)', async () => {
    const { id: uid } = await seedUser({ mustChangePassword: true });
    const { sessionId } = await createSession(uid);
    const e = evt({ path: '/api/companies', cookies: { bo_session: sessionId } });
    await guard(e);
    expect(e.context.user.id).toBe(uid);
  });

  it('allows POST /api/auth/change-password when mustChangePassword=true (the escape hatch)', async () => {
    const { id: uid } = await seedUser({ mustChangePassword: true });
    const { sessionId } = await createSession(uid);
    const e = evt({ path: '/api/auth/change-password', method: 'POST', cookies: { bo_session: sessionId }, headers: { origin: 'https://bo.example.com' } });
    await guard(e);   // CSRF-exempt AND mustChangePassword-exempt
    expect(e.context.user).toBeDefined();
  });

  // Finding: APP_INGEST_DEVICE should require Authorization header (M1.10 code-review)
  it('401s POST /api/apps/:id/devices with no Authorization header', async () => {
    await expect(guard(evt({ path: '/api/apps/abc/devices', method: 'POST' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('401s POST /api/apps/:id/devices with non-Bearer Authorization', async () => {
    await expect(guard(evt({ path: '/api/apps/abc/devices', method: 'POST', headers: { authorization: 'Basic dXNlcjpwYXNz' } }))).rejects.toMatchObject({ statusCode: 401 });
  });
});
