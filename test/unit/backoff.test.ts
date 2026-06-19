import { describe, it, expect, vi } from 'vitest';
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

  it('jitter uses the full exp range (true full jitter, not bounded to BASE_MS)', () => {
    // At attempt=1 exp=BASE_MS=5000ms, so full jitter is [0,5000). At high attempts
    // exp reaches CEILING_MS=3600000ms and jitter should cover [0,3600000), not just [0,4999).
    // Seed Math.random to 0.9 and verify the jitter component exceeds BASE_MS (5000ms).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const now = Date.now();
      // attempt=10: exp = min(5000 * 2^9, 3600000) = min(2560000, 3600000) = 2560000ms
      // jitter (true full) = floor(0.9 * 2560000) = 2304000ms, well above BASE_MS of 5000ms
      const d = nextRunAfter(10).getTime() - now;
      expect(d).toBeGreaterThan(5_000); // jitter alone should exceed BASE_MS ceiling
    } finally {
      randomSpy.mockRestore();
    }
  });
});
