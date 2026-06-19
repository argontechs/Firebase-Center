import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NUXT_DATABASE_URL =
    process.env.NUXT_DATABASE_URL ??
    'postgres://firebase_center:change_me_postgres@localhost:5432/firebase_center';
});

describe('server/db/client canonical exports', () => {
  it('exports db, pool, client, schema and useDb', async () => {
    const mod = await import('./client');
    expect(mod.db).toBeTruthy();
    expect(mod.pool).toBeTruthy();
    expect(mod.schema).toBeTruthy();
    // `client` is the M2 import binding; it must alias `db`.
    expect(mod.client).toBe(mod.db);
    // `useDb(event)` is the M4 import binding; it returns the shared db.
    expect(typeof mod.useDb).toBe('function');
    expect(mod.useDb({} as never)).toBe(mod.db);
  });
});
