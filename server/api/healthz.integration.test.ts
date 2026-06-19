import { describe, it, expect, beforeAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// Set env before importing healthz.get so client.ts does not throw at load time.
let checkHealth: (typeof import('./healthz.get'))['checkHealth'];
beforeAll(async () => {
  process.env.NUXT_DATABASE_URL ??=
    'postgres://firebase_center:change_me_postgres@localhost:5432/firebase_center';
  ({ checkHealth } = await import('./healthz.get'));
});

const url = process.env.NUXT_DATABASE_URL;
const run = url ? describe : describe.skip;

run('healthz against a real Postgres', () => {
  it('reports db up when connected', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const res = await checkHealth((sql) => pool.query(sql));
      expect(res.statusCode).toBe(200);
      expect(res.body.db).toBe('up');
    } finally {
      await pool.end();
    }
  });
});
