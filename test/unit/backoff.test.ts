import { describe, it, expect } from 'vitest';
import { nextRunAfter } from '../../server/utils/queue/backoff';

describe('nextRunAfter', () => {
  it('grows roughly exponentially with attempts', () => {
    const now = Date.now();
    const a1 = nextRunAfter(1).getTime() - now;
    const a3 = nextRunAfter(3).getTime() - now;
    expect(a3).toBeGreaterThan(a1);
  });

  it('honors an explicit retryAfterMs lower bound when larger than backoff', () => {
    const now = Date.now();
    const d = nextRunAfter(1, 120_000).getTime() - now;
    expect(d).toBeGreaterThanOrEqual(110_000); // ~120s minus jitter slack
  });

  it('caps the delay (never unbounded)', () => {
    const now = Date.now();
    const d = nextRunAfter(50).getTime() - now;
    expect(d).toBeLessThanOrEqual(60 * 60 * 1000); // hard ceiling 1h
  });
});
