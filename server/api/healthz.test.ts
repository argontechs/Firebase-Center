import { describe, it, expect, vi, beforeAll } from 'vitest';

// Set env before the module import so client.ts does not throw at load time.
let checkHealth: (typeof import('./healthz.get'))['checkHealth'];
beforeAll(async () => {
  process.env.NUXT_DATABASE_URL ??=
    'postgres://firebase_center:change_me_postgres@localhost:5432/firebase_center';
  ({ checkHealth } = await import('./healthz.get'));
});

describe('checkHealth', () => {
  it('returns ok/up when the db query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await checkHealth(query);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns error/down + 503 when the db query throws', async () => {
    const query = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await checkHealth(query);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });
});
