import { describe, it, expect } from 'vitest';
import {
  issueCsrfToken, serializeCsrfCookie, verifyDoubleSubmit, verifyOrigin,
  parseAllowedOrigins,
  CSRF_COOKIE_NAME, CSRF_HEADER_NAME,
} from './csrf';

describe('csrf', () => {
  it('issues a non-trivial token', () => {
    const t = issueCsrfToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(issueCsrfToken()).not.toBe(t);
  });

  it('serializes a readable (non-HttpOnly) cookie', () => {
    const c = serializeCsrfCookie('abc');
    expect(c).toContain(`${CSRF_COOKIE_NAME}=abc`);
    expect(c).not.toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
  });

  it('double-submit passes only when cookie === header and both present', () => {
    const t = issueCsrfToken();
    expect(verifyDoubleSubmit(t, t)).toBe(true);
    expect(verifyDoubleSubmit(t, 'other')).toBe(false);
    expect(verifyDoubleSubmit(undefined, t)).toBe(false);
    expect(verifyDoubleSubmit(t, undefined)).toBe(false);
    expect(verifyDoubleSubmit('', '')).toBe(false);
  });

  it('header name constant is the lowercased x-csrf-token', () => {
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
  });

  it('origin check accepts allowed origin and matching referer, rejects others', () => {
    const allowed = ['https://bo.example.com'];
    expect(verifyOrigin('https://bo.example.com', allowed)).toBe(true);
    expect(verifyOrigin('https://bo.example.com/login', allowed)).toBe(true); // referer w/ path
    expect(verifyOrigin('https://evil.com', allowed)).toBe(false);
    expect(verifyOrigin(undefined, allowed)).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('splits a comma-separated string and trims whitespace', () => {
    expect(parseAllowedOrigins('https://a.example.com , https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('handles a single origin string with no commas', () => {
    expect(parseAllowedOrigins('https://push.example.com')).toEqual(['https://push.example.com']);
  });

  it('passes through an array unchanged (Array.isArray branch)', () => {
    const arr = ['https://bo.example.com', 'https://push.example.com'];
    expect(parseAllowedOrigins(arr)).toBe(arr);
  });

  it('returns [] for an empty string', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('filters out blank entries from comma-separated string', () => {
    expect(parseAllowedOrigins('https://a.example.com,,https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});
