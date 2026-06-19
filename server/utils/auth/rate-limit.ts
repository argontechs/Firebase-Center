export const MAX_FAILURES_BEFORE_LOCKOUT = 5;
export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

interface Entry { failures: number; lastFailureAt: number; }

// Per-account (email) failure store
const accountStore = new Map<string, Entry>();

// Per-IP aggregate failure store: counts total failures across ALL accounts on that IP
const ipStore = new Map<string, Entry>();

// Per (email + IP) contribution tracker: records how many failures each account has
// contributed to the shared IP counter so we can subtract them on successful login
// without clearing other accounts' contributions.
const ipContribStore = new Map<string, number>();

function ipContribKey(email: string, ip: string): string {
  return `${email.toLowerCase()}::${ip}`;
}

function backoffFor(failures: number): number {
  if (failures < MAX_FAILURES_BEFORE_LOCKOUT) return 0;
  const over = failures - MAX_FAILURES_BEFORE_LOCKOUT; // 0 at threshold
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
  const email = key.email.toLowerCase();
  bump(accountStore, email, now);
  bump(ipStore, key.ip, now);
  // Track this account's individual contribution to the IP counter
  const ck = ipContribKey(email, key.ip);
  ipContribStore.set(ck, (ipContribStore.get(ck) ?? 0) + 1);
}

export function recordLoginSuccess(key: { email: string; ip: string }): void {
  const email = key.email.toLowerCase();

  // Clear the account (email) counter — the login succeeded for this user.
  accountStore.delete(email);

  // Subtract only this account's contribution from the shared IP counter so
  // that failures caused by other accounts on the same IP remain in effect.
  // This prevents an attacker from bypassing IP-axis lockout by successfully
  // authenticating with their own account from the same IP.
  const ck = ipContribKey(email, key.ip);
  const contrib = ipContribStore.get(ck) ?? 0;
  ipContribStore.delete(ck);

  if (contrib > 0) {
    const ipEntry = ipStore.get(key.ip);
    if (ipEntry) {
      ipEntry.failures = Math.max(0, ipEntry.failures - contrib);
      if (ipEntry.failures === 0) {
        ipStore.delete(key.ip);
      }
      // Note: we intentionally leave lastFailureAt unchanged — the most recent
      // failure timestamp from other accounts still applies.
    }
  }
}

export function resetRateLimitStore(): void {
  accountStore.clear();
  ipStore.clear();
  ipContribStore.clear();
}
