export const MAX_FAILURES_BEFORE_LOCKOUT = 5;
export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

interface Entry { failures: number; lastFailureAt: number; }
const accountStore = new Map<string, Entry>();
const ipStore = new Map<string, Entry>();

function backoffFor(failures: number): number {
  if (failures < MAX_FAILURES_BEFORE_LOCKOUT) return 0;
  const over = failures - MAX_FAILURES_BEFORE_LOCKOUT;       // 0 at threshold
  return Math.min(BASE_BACKOFF_MS * 2 ** over, MAX_BACKOFF_MS);
}

function evaluate(store: Map<string, Entry>, id: string, now: number): number {
  const e = store.get(id);
  if (!e) return 0;
  const wait = backoffFor(e.failures);
  if (wait === 0) return 0;
  const remaining = e.lastFailureAt + wait - now;
  return remaining > 0 ? remaining : 0;
}

function bump(store: Map<string, Entry>, id: string, now: number): void {
  const e = store.get(id) ?? { failures: 0, lastFailureAt: 0 };
  e.failures += 1;
  e.lastFailureAt = now;
  store.set(id, e);
}

export function checkLoginAllowed(
  key: { email: string; ip: string },
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const acctWait = evaluate(accountStore, key.email.toLowerCase(), now);
  const ipWait = evaluate(ipStore, key.ip, now);
  const wait = Math.max(acctWait, ipWait);
  return wait > 0 ? { allowed: false, retryAfterMs: wait } : { allowed: true };
}

export function recordLoginFailure(key: { email: string; ip: string }, now: number = Date.now()): void {
  bump(accountStore, key.email.toLowerCase(), now);
  bump(ipStore, key.ip, now);
}

export function recordLoginSuccess(key: { email: string; ip: string }): void {
  accountStore.delete(key.email.toLowerCase());
  ipStore.delete(key.ip);
}

export function resetRateLimitStore(): void {
  accountStore.clear();
  ipStore.clear();
}
