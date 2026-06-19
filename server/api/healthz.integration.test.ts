import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { checkHealth } from './healthz.get';

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
