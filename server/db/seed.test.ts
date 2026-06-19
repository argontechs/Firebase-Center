import { describe, it, expect, beforeEach, vi } from 'vitest';

// Injected count used by seedFirstAdmin (no real DB).
const state = { userCount: 0 };

vi.mock('./client', () => ({
  db: {
    // seedFirstAdmin uses this hook in tests instead of a real select count.
    async _countUsers() { return state.userCount; },
  },
  pool: { end: async () => {} },
  schema: {},
}));

vi.mock('drizzle-orm', async (orig) => {
  const actual = await orig<typeof import('drizzle-orm')>();
  return actual;
});

import { seedFirstAdmin, SeedError } from './seed';

describe('seedFirstAdmin (idempotent)', () => {
  beforeEach(() => {
    state.userCount = 0;
    process.env.NUXT_BO_ADMIN_EMAIL = 'admin@example.com';
    process.env.NUXT_BO_ADMIN_PASSWORD = 'strong_password_123456';
  });

  it('seeds when the users table is empty', async () => {
    state.userCount = 0;
    const r = await seedFirstAdmin();
    expect(r.seeded).toBe(true);
  });

  it('is a no-op when a user already exists', async () => {
    state.userCount = 1;
    const r = await seedFirstAdmin();
    expect(r.seeded).toBe(false);
  });

  it('throws a SeedError mentioning BO_ADMIN when users is empty AND admin env is unset', async () => {
    state.userCount = 0;
    delete process.env.NUXT_BO_ADMIN_EMAIL;
    delete process.env.NUXT_BO_ADMIN_PASSWORD;
    await expect(seedFirstAdmin()).rejects.toBeInstanceOf(SeedError);
    await expect(seedFirstAdmin()).rejects.toThrow(/BO_ADMIN/);
  });
});
