import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, truncate, closeDb } from '~/server/test/db';
import { users, auditLog, sessions } from '~/server/db/schema';
import { seedUser } from '~/server/test/auth';
import { createSession } from '~/server/utils/auth/session';

vi.mock('h3', () => ({
  readBody: async (e: any) => e._body,
  getCookie: (e: any, n: string) => e._cookies?.[n],
  getRouterParam: (e: any, n: string) => e._params?.[n],
  setResponseStatus: (e: any, s: number) => { e._status = s; },
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
  defineEventHandler: (fn: any) => fn,
}));

import createUser from './index.post';
import disableUser from './[id]/disable.post';
import patchUser from './[id]/index.patch';

async function adminEvt(body?: any, params?: any) {
  const admin = await seedUser({ role: 'admin' });
  const { sessionId } = await createSession(admin.id);
  return { actor: admin, e: { _body: body, _params: params, _cookies: { bo_session: sessionId } } as any };
}
async function operatorEvt(body?: any) {
  const op = await seedUser({ role: 'operator' });
  const { sessionId } = await createSession(op.id);
  return { _body: body, _cookies: { bo_session: sessionId } } as any;
}
beforeEach(async () => { await truncate('sessions', 'audit_log', 'users'); });
afterAll(async () => { await closeDb(); });

describe('admin user management', () => {
  it('admin creates an operator with mustChangePassword, audits user_create', async () => {
    const { e } = await adminEvt({ email: 'new@bo.com', role: 'operator', password: 'Created-Str0ng!1' });
    const res = await createUser(e);
    expect(res.email).toBe('new@bo.com');
    expect(res.role).toBe('operator');
    const [row] = await db.select().from(users).where(eq(users.email, 'new@bo.com'));
    expect(row.mustChangePassword).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'user_create'))).toHaveLength(1);
  });

  it('non-admin is forbidden (403)', async () => {
    const e = await operatorEvt({ email: 'x@bo.com', role: 'operator', password: 'Created-Str0ng!1' });
    await expect(createUser(e)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('disable sets status=disabled, kills sessions, audits user_disable', async () => {
    const target = await seedUser({ role: 'operator' });
    await createSession(target.id);
    const { e } = await adminEvt(undefined, { id: target.id });
    await disableUser(e);
    expect(e._status).toBe(204);
    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.status).toBe('disabled');
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'user_disable'))).toHaveLength(1);
  });

  it('patch changes the role, audits role_change', async () => {
    const target = await seedUser({ role: 'operator' });
    const { e } = await adminEvt({ role: 'admin' }, { id: target.id });
    const res = await patchUser(e);
    expect(res.role).toBe('admin');
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'role_change'))).toHaveLength(1);
  });

  it('create rejects a weak password (400)', async () => {
    const { e } = await adminEvt({ email: 'weak@bo.com', role: 'operator', password: 'weak' });
    await expect(createUser(e)).rejects.toMatchObject({ statusCode: 400 });
  });
});
