import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, truncate, closeDb } from '~~/server/test/db';
import { users } from '~~/server/db/schema';
import { hashPassword } from '~~/server/utils/auth/password';
import { seedFirstAdmin, validatePasswordStrength, SeedError } from './seed';

const goodEnv = { BO_ADMIN_EMAIL: 'admin@bo.com', BO_ADMIN_PASSWORD: 'Str0ng-Passw0rd!' };
beforeEach(async () => { await truncate('sessions', 'audit_log', 'users'); });
afterAll(async () => { await closeDb(); });

describe('seedFirstAdmin', () => {
  it('seeds an admin with mustChangePassword when users empty', async () => {
    const r = await seedFirstAdmin(goodEnv);
    expect(r.seeded).toBe(true);
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('admin');
    expect(rows[0].mustChangePassword).toBe(true);
    expect(rows[0].passwordHash).not.toBe('Str0ng-Passw0rd!');
  });

  it('is idempotent — no reseed when an admin already exists', async () => {
    await db.insert(users).values({ email: 'existing@bo.com', passwordHash: await hashPassword('x'), role: 'admin' });
    const r = await seedFirstAdmin(goodEnv);
    expect(r.seeded).toBe(false);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('fails loudly when users empty and env unset', async () => {
    await expect(seedFirstAdmin({})).rejects.toBeInstanceOf(SeedError);
  });

  it('fails loudly when the seed password is too weak', async () => {
    await expect(seedFirstAdmin({ BO_ADMIN_EMAIL: 'a@b.com', BO_ADMIN_PASSWORD: 'weak' })).rejects.toBeInstanceOf(SeedError);
  });

  it('validatePasswordStrength enforces length + classes', () => {
    expect(validatePasswordStrength('Str0ng-Passw0rd!').ok).toBe(true);
    expect(validatePasswordStrength('short1!A').ok).toBe(false);
    expect(validatePasswordStrength('alllowercase123!').ok).toBe(false);
    expect(validatePasswordStrength('NoSymbol1234A').ok).toBe(false);
  });
});
