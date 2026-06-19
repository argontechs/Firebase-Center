import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkLoginAllowed, recordLoginFailure, recordLoginSuccess, resetRateLimitStore,
  MAX_FAILURES_BEFORE_LOCKOUT, BASE_BACKOFF_MS,
} from './rate-limit';

const key = { email: 'a@b.com', ip: '1.2.3.4' };
beforeEach(() => resetRateLimitStore());

describe('rate-limit', () => {
  it('allows initially', () => {
    expect(checkLoginAllowed(key, 0)).toEqual({ allowed: true });
  });

  it('locks out after MAX_FAILURES with exponential backoff', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) recordLoginFailure(key, 0);
    const res = checkLoginAllowed(key, 0);
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it('backoff grows exponentially with each failure past the threshold', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) recordLoginFailure(key, 0);
    const a = checkLoginAllowed(key, 0);
    recordLoginFailure(key, 0);
    const b = checkLoginAllowed(key, 0);
    if (!a.allowed && !b.allowed) expect(b.retryAfterMs).toBeGreaterThan(a.retryAfterMs);
  });

  it('allows again once the backoff window passes', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) recordLoginFailure(key, 0);
    const locked = checkLoginAllowed(key, 0);
    if (locked.allowed) throw new Error('should be locked');
    expect(checkLoginAllowed(key, locked.retryAfterMs + 1).allowed).toBe(true);
  });

  it('locks on the IP axis even when emails differ', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) {
      recordLoginFailure({ email: `x${i}@b.com`, ip: '9.9.9.9' }, 0);
    }
    expect(checkLoginAllowed({ email: 'fresh@b.com', ip: '9.9.9.9' }, 0).allowed).toBe(false);
  });

  it('success clears the account counter', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) recordLoginFailure(key, 0);
    recordLoginSuccess(key);
    expect(checkLoginAllowed(key, 0).allowed).toBe(true);
  });

  it('first backoff equals BASE_BACKOFF_MS at the threshold', () => {
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) recordLoginFailure(key, 0);
    const res = checkLoginAllowed(key, 0);
    if (!res.allowed) expect(res.retryAfterMs).toBe(BASE_BACKOFF_MS);
  });

  it('success does NOT reset the IP counter (cross-account bypass prevention)', () => {
    const sharedIp = '5.5.5.5';
    // Accumulate N-1 failures against a victim account from the shared IP
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT - 1; i++) {
      recordLoginFailure({ email: 'victim@b.com', ip: sharedIp }, 0);
    }
    // Attacker adds the final failure to trigger IP-axis lockout
    recordLoginFailure({ email: 'victim@b.com', ip: sharedIp }, 0);
    // Confirm IP is now locked
    expect(checkLoginAllowed({ email: 'fresh@b.com', ip: sharedIp }, 0).allowed).toBe(false);
    // Attacker successfully authenticates with their own account from the same IP
    recordLoginSuccess({ email: 'attacker@b.com', ip: sharedIp });
    // IP lockout must remain in effect — success must NOT have cleared the IP counter
    expect(checkLoginAllowed({ email: 'fresh@b.com', ip: sharedIp }, 0).allowed).toBe(false);
  });

  it('success removes only the logged-in account\'s IP contribution; other-account failures remain', () => {
    const sharedIp = '6.6.6.6';
    // Two separate accounts each fail N/2+ times so that together they reach the IP threshold
    // Account A contributes enough to hit lockout on its own
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) {
      recordLoginFailure({ email: 'accountA@b.com', ip: sharedIp }, 0);
    }
    // Confirm IP is locked
    expect(checkLoginAllowed({ email: 'fresh@b.com', ip: sharedIp }, 0).allowed).toBe(false);
    // Account B also adds a failure (total = N+1)
    recordLoginFailure({ email: 'accountB@b.com', ip: sharedIp }, 0);
    // Account B succeeds — only its 1 failure should be subtracted from IP counter (N+1-1 = N)
    recordLoginSuccess({ email: 'accountB@b.com', ip: sharedIp });
    // IP is still locked because account A's N failures remain
    expect(checkLoginAllowed({ email: 'fresh@b.com', ip: sharedIp }, 0).allowed).toBe(false);
  });
});
