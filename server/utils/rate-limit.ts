/**
 * Generic in-memory sliding-window rate limiter.
 *
 * Each `key` (e.g. "ingest:key:<keyId>", "ingest:ip:<ip>") has its own
 * sliding window.  Throws a 429 H3Error when the limit is exceeded.
 *
 * The store is intentionally module-level so it survives across requests
 * within the same Node.js process.  Call `resetRateLimits()` in test
 * `beforeEach` hooks to isolate tests.
 */

import { createError } from 'h3';

interface Window {
  hits: number;
  windowStart: number;
}

const store = new Map<string, Window>();

/**
 * Checks and increments the hit counter for `key` within `windowMs`.
 * Throws 429 if `limit` is exceeded.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): void {
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // First hit or window expired — start fresh
    store.set(key, { hits: 1, windowStart: now });
    return;
  }

  entry.hits += 1;
  if (entry.hits > limit) {
    throw createError({ statusCode: 429, statusMessage: 'rate limit exceeded' });
  }
}

/** Clears all rate-limit windows. Call in test beforeEach to isolate tests. */
export function resetRateLimits(): void {
  store.clear();
}
