import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, truncate, closeDb } from '~~/server/test/db';
import { auditLog } from '~~/server/db/schema';
import { audit } from './audit';

beforeEach(async () => { await truncate('audit_log', 'users'); });
afterAll(async () => { await closeDb(); });

describe('audit', () => {
  it('writes a row with a canonical action and metadata', async () => {
    await audit({ action: 'login_failure', userId: null, targetType: 'email', targetId: 'a@b.com', meta: { ip: '1.2.3.4' } });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'login_failure'));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].targetId).toBe('a@b.com');
    expect(rows[0].metaJsonb).toEqual({ ip: '1.2.3.4' });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('accepts a userId for an authenticated action', async () => {
    const uid = '00000000-0000-0000-0000-000000000001';
    // Seed the user so the audit_log FK (user_id -> users.id) is satisfied.
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, role, status, must_change_password)
      VALUES (${uid}::uuid, 'audit-test@bo.com', 'x', 'operator', 'active', false)
      ON CONFLICT (id) DO NOTHING
    `);
    await audit({ action: 'logout', userId: uid });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'logout'));
    expect(rows[0].userId).toBe(uid);
  });
});
