import { describe, it, expect, vi } from 'vitest';
import { checkHealth } from './healthz.get';

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
