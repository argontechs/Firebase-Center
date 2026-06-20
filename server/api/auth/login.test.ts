import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db, truncate, closeDb } from '~~/server/test/db';
import { users, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '~~/server/utils/auth/password';
import { resetRateLimitStore } from '~~/server/utils/auth/rate-limit';

// Stub Nuxt's #imports so guard.ts (requireUser) can be imported without Nuxt runtime.
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ allowedOrigins: ['https://localhost:3000'] }) }), { virtual: true });

// h3 helpers used by the handler are stubbed to read from a fake event.
vi.mock('h3', () => ({
  readBody: async (e: any) => e._body,
  getRequestHeader: (e: any, h: string) => e._headers?.[h.toLowerCase()],
  setResponseHeader: (e: any, k: string, v: string) => { e._res ??= {}; e._res[k] = v; },
  setResponseStatus: (e: any, s: number) => { e._status = s; },
  getCookie: (e: any, n: string) => e._cookies?.[n],
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
  defineEventHandler: (fn: any) => fn,
}));

import loginHandler from './login.post';
import meHandler from './me.get';

function evt(opts: { body?: any; headers?: Record<string,string>; cookies?: Record<string,string>; socketIp?: string } = {}) {
  return {
    _body: opts.body,
    _headers: opts.headers ?? { 'x-forwarded-for': '1.1.1.1' },
    _cookies: opts.cookies ?? {},
    node: { req: { socket: { remoteAddress: opts.socketIp ?? '127.0.0.1' } } },
  } as any;
}

beforeEach(async () => { await truncate('sessions', 'audit_log', 'users'); resetRateLimitStore(); });
afterAll(async () => { await closeDb(); });

async function seedAdmin() {
  await db.insert(users).values({ email: 'admin@bo.com', passwordHash: await hashPassword('Str0ng-Passw0rd!'), role: 'admin', mustChangePassword: true });
}

describe('POST /api/auth/login', () => {
  it('logs in valid creds, sets a cookie, returns mustChangePassword, audits success', async () => {
    await seedAdmin();
    const e = evt({ body: { email: 'admin@bo.com', password: 'Str0ng-Passw0rd!' } });
    const res = await loginHandler(e);
    expect(res.user.email).toBe('admin@bo.com');
    expect(res.mustChangePassword).toBe(true);
    expect(e._res['Set-Cookie']).toContain('bo_session=');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'login_success'));
    expect(audits).toHaveLength(1);
  });

  it('rejects bad password with 401 and audits a login_failure', async () => {
    await seedAdmin();
    const e = evt({ body: { email: 'admin@bo.com', password: 'wrong' } });
    await expect(loginHandler(e)).rejects.toMatchObject({ statusCode: 401 });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'login_failure'));
    expect(audits).toHaveLength(1);
  });

  it('returns 429 after repeated failures (lockout)', async () => {
    await seedAdmin();
    for (let i = 0; i < 5; i++) {
      await loginHandler(evt({ body: { email: 'admin@bo.com', password: 'wrong' } })).catch(() => {});
    }
    await expect(loginHandler(evt({ body: { email: 'admin@bo.com', password: 'Str0ng-Passw0rd!' } })))
      .rejects.toMatchObject({ statusCode: 429 });
  });

  it('spoofed X-Forwarded-For does not bypass per-IP lockout (F8)', async () => {
    // All requests share the same socket.remoteAddress (same physical connection).
    // An attacker varies the X-Forwarded-For header on each request trying to get
    // a fresh IP bucket.  With NUXT_TRUST_PROXY unset (default = off), the XFF
    // header must be IGNORED and the socket IP must be used instead, so all
    // requests count toward the SAME IP bucket and lockout fires after MAX_FAILURES.
    await seedAdmin();
    delete process.env.NUXT_TRUST_PROXY;
    const sharedSocketIp = '10.20.30.40';
    for (let i = 0; i < 5; i++) {
      // Each attempt spoofs a different XFF value — on old code this defeats lockout.
      const e = evt({
        body: { email: 'admin@bo.com', password: 'wrong' },
        headers: { 'x-forwarded-for': `spoofed-${i}.example.com` },
        socketIp: sharedSocketIp,
      });
      await loginHandler(e).catch(() => {});
    }
    // The 6th attempt (with yet another spoofed XFF) must still be locked out
    // because the socket IP was used for all 5 failures.
    const finalEvt = evt({
      body: { email: 'admin@bo.com', password: 'Str0ng-Passw0rd!' },
      headers: { 'x-forwarded-for': 'spoofed-99.example.com' },
      socketIp: sharedSocketIp,
    });
    await expect(loginHandler(finalEvt)).rejects.toMatchObject({ statusCode: 429 });
  });
});

describe('GET /api/auth/me', () => {
  it('401 without a session', async () => {
    await expect(meHandler(evt())).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns user and re-emits Set-Cookie to slide the idle timeout', async () => {
    await seedAdmin();
    // First log in to get a real session cookie.
    const loginEvt = evt({ body: { email: 'admin@bo.com', password: 'Str0ng-Passw0rd!' } });
    const loginRes = await loginHandler(loginEvt);
    expect(loginRes.user.email).toBe('admin@bo.com');

    // Extract the session id from the Set-Cookie value written during login.
    const setCookieAfterLogin: string = loginEvt._res['Set-Cookie'];
    expect(setCookieAfterLogin).toContain('bo_session=');
    const sessionId = setCookieAfterLogin.split(';')[0].split('=').slice(1).join('=');

    // Call /me with the session cookie present.
    const meEvt = evt({ cookies: { bo_session: sessionId } });
    const meRes = await meHandler(meEvt);

    // Should return the user.
    expect(meRes.user.email).toBe('admin@bo.com');
    expect(meRes.mustChangePassword).toBe(true);

    // Must re-emit Set-Cookie so the browser slides its Max-Age.
    const setCookieAfterMe: string = meEvt._res?.['Set-Cookie'] ?? '';
    expect(setCookieAfterMe).toContain('bo_session=');
    expect(setCookieAfterMe).toContain('Max-Age=1800'); // 30 * 60 seconds
  });
});
