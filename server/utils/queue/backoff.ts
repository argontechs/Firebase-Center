const BASE_MS = 5_000;
const CEILING_MS = 60 * 60 * 1000; // 1h hard cap

/**
 * Returns the next `run_after` timestamp for a retried job.
 *
 * Uses exponential backoff with full jitter, hard-capped at 1 hour.
 *
 * @param attempts - number of attempts already made (1 = first retry)
 * @param retryAfterMs - optional lower bound from a provider Retry-After header;
 *   when present the delay will be at least this value (still capped at 1h).
 *   No FCM/Huawei adapter currently surfaces this — pass undefined until one does.
 */
export function nextRunAfter(attempts: number, retryAfterMs?: number): Date {
  const exp = Math.min(BASE_MS * 2 ** Math.max(0, attempts - 1), CEILING_MS);
  // True full jitter (AWS definition): delay is random in [0, exp).
  // This means the delay can be as low as 0, which improves throughput under
  // load compared to the previous [exp, 2*exp] range that had a hard floor.
  const backoff = Math.floor(Math.random() * exp);
  const delay = Math.min(Math.max(backoff, retryAfterMs ?? 0), CEILING_MS);
  return new Date(Date.now() + delay);
}
