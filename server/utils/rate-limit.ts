/**
 * Generic in-memory sliding-window rate limiter.
 *
 * Each `key` (e.g. "ingest:key:<keyId>", "ingest:ip:<ip>") has its own
 * sliding window.  Throws a 429 H3Error when the limit is exceeded.
 *
 * Uses a true sliding window via a per-key ring buffer of hit timestamps,
 * so bursts that straddle a minute boundary are correctly counted across
 * the full `windowMs` look-back period.
 *
 * The store is intentionally module-level so it survives across requests
 * within the same Node.js process.  Call `resetRateLimits()` in test
 * `beforeEach` hooks to isolate tests.
 */

import { createError } from 'h3';

/** Ordered list of hit timestamps (oldest first) for one rate-limit key. */
const store = new Map<string, number[]>();

/**
 * Checks and records a hit for `key` within the sliding `windowMs`.
 * Throws 429 if the number of hits in the window exceeds `limit`.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): void {
  const cutoff = now - windowMs;

  // Get or create the hit-timestamp list for this key.
  let hits = store.get(key);
  if (!hits) {
    hits = [];
    store.set(key, hits);
  }

  // Evict timestamps that have fallen outside the sliding window.
  let start = 0;
  while (start < hits.length && hits[start] <= cutoff) start++;
  if (start > 0) hits.splice(0, start);

  // Now check before adding — so the limit-th hit is allowed but (limit+1)-th is not.
  if (hits.length >= limit) {
    throw createError({ statusCode: 429, statusMessage: 'rate limit exceeded' });
  }

  hits.push(now);
}

/** Clears all rate-limit windows. Call in test beforeEach to isolate tests. */
export function resetRateLimits(): void {
  store.clear();
}
