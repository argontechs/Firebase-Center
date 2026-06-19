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
});
