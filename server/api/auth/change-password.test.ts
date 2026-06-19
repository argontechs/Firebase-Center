import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, truncate, closeDb } from '~/server/test/db';
import { users, auditLog, sessions } from '~/server/db/schema';
import { hashPassword } from '~/server/utils/auth/password';
import { createSession } from '~/server/utils/auth/session';

// Stub Nuxt's #imports so guard.ts (requireSession) can be imported without Nuxt runtime.
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ allowedOrigins: ['https://localhost:3000'] }) }), { virtual: true });

vi.mock('h3', () => ({
  readBody: async (e: any) => e._body,
  getCookie: (e: any, n: string) => e._cookies?.[n],
  setResponseHeader: (e: any, k: string, v: string) => { e._res ??= {}; e._res[k] = v; },
  setResponseStatus: (e: any, s: number) => { e._status = s; },
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
  defineEventHandler: (fn: any) => fn,
}));

import changePassword from './change-password.post';
import logout from './logout.post';

async function seedUserWithSession() {
  const [u] = await db.insert(users).values({ email: 'op@bo.com', passwordHash: await hashPassword('Old-Passw0rd!1'), mustChangePassword: true }).returning();
  const { sessionId } = await createSession(u.id);
  return { uid: u.id, sessionId };
}
beforeEach(async () => { await truncate('sessions', 'audit_log', 'users'); });
afterAll(async () => { await closeDb(); });

describe('change-password', () => {
  it('changes password, clears mustChangePassword, kills old sessions, issues a new cookie, audits', async () => {
    const { uid, sessionId } = await seedUserWithSession();
    const e: any = { _body: { currentPassword: 'Old-Passw0rd!1', newPassword: 'New-Str0ng!2x' }, _cookies: { bo_session: sessionId } };
    await changePassword(e);
    expect(e._status).toBe(204);
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    expect(u.mustChangePassword).toBe(false);
    // old session gone, a brand-new one present
    const live = await db.select().from(sessions).where(eq(sessions.userId, uid));
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(sessionId);
    expect(e._res['Set-Cookie']).toContain('bo_session=');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'password_change'));
    expect(audits).toHaveLength(1);
  });

  it('rejects a wrong current password with 401', async () => {
    const { sessionId } = await seedUserWithSession();
    const e: any = { _body: { currentPassword: 'nope', newPassword: 'New-Str0ng!2x' }, _cookies: { bo_session: sessionId } };
    await expect(changePassword(e)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a disabled operator with 401 even with a valid session', async () => {
    const [u] = await db.insert(users).values({ email: 'disabled@bo.com', passwordHash: await hashPassword('Old-Passw0rd!1'), status: 'disabled' }).returning();
    const { sessionId } = await createSession(u.id);
    const e: any = { _body: { currentPassword: 'Old-Passw0rd!1', newPassword: 'New-Str0ng!2x' }, _cookies: { bo_session: sessionId } };
    await expect(changePassword(e)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a weak new password with 400', async () => {
    const { sessionId } = await seedUserWithSession();
    const e: any = { _body: { currentPassword: 'Old-Passw0rd!1', newPassword: 'weak' }, _cookies: { bo_session: sessionId } };
    await expect(changePassword(e)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('logout', () => {
  it('destroys the session, clears the cookie, returns 204, audits logout', async () => {
    const { uid, sessionId } = await seedUserWithSession();
    const e: any = { _cookies: { bo_session: sessionId } };
    await logout(e);
    expect(e._status).toBe(204);
    expect(e._res['Set-Cookie']).toContain('Max-Age=0');
    expect(await db.select().from(sessions).where(eq(sessions.userId, uid))).toHaveLength(0);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'logout'));
    expect(audits).toHaveLength(1);
  });
});
