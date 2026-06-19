import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db, truncate, closeDb } from '~~/server/test/db';
import { seedUser } from '~~/server/test/auth';
import { createSession } from './session';

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ allowedOrigins: ['https://bo.example.com'] }) }), { virtual: true });
vi.mock('h3', () => ({
  getCookie: (e: any, n: string) => e._cookies?.[n],
  getRequestHeader: (e: any, h: string) => e._headers?.[h.toLowerCase()],
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
  defineEventHandler: (fn: any) => fn,
}));

import { requireSession, requireUser, assertCsrf, requireCsrf } from './guard';

function evt(o: { cookies?: any; headers?: any } = {}) {
  return { _cookies: o.cookies ?? {}, _headers: o.headers ?? {} } as any;
}
beforeEach(async () => { await truncate('sessions', 'users'); });
afterAll(async () => { await closeDb(); });

describe('auth guards', () => {
  it('requireSession returns the userId on a valid session', async () => {
    const { id: uid } = await seedUser();
    const { sessionId } = await createSession(uid);
    expect(await requireSession(evt({ cookies: { bo_session: sessionId } }))).toEqual({ userId: uid });
  });

  it('requireSession throws 401 with no session', async () => {
    await expect(requireSession(evt())).rejects.toMatchObject({ statusCode: 401 });
  });

  it('requireUser loads the row and exposes role', async () => {
    const { id: uid } = await seedUser({ role: 'admin' });
    const { sessionId } = await createSession(uid);
    const u = await requireUser(evt({ cookies: { bo_session: sessionId } }));
    expect(u.id).toBe(uid);
    expect(u.role).toBe('admin');
  });

  it('requireUser throws 401 for a disabled user', async () => {
    const { id: uid } = await seedUser({ status: 'disabled' });
    const { sessionId } = await createSession(uid);
    await expect(requireUser(evt({ cookies: { bo_session: sessionId } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('assertCsrf passes with matching token + allowed origin', () => {
    expect(() => assertCsrf(evt({ cookies: { bo_csrf: 'tok' }, headers: { origin: 'https://bo.example.com', 'x-csrf-token': 'tok' } }))).not.toThrow();
  });

  it('assertCsrf throws 403 on token mismatch', () => {
    expect(() => assertCsrf(evt({ cookies: { bo_csrf: 'tok' }, headers: { origin: 'https://bo.example.com', 'x-csrf-token': 'other' } }))).toThrow();
  });

  it('assertCsrf throws 403 on foreign origin', () => {
    expect(() => assertCsrf(evt({ cookies: { bo_csrf: 'tok' }, headers: { origin: 'https://evil.com', 'x-csrf-token': 'tok' } }))).toThrow();
  });

  it('requireCsrf is the same function as assertCsrf', () => {
    expect(requireCsrf).toBe(assertCsrf);
  });
});
