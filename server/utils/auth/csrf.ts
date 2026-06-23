import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE_NAME = 'bo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

// Readable by JS on purpose: the SPA reads it and echoes it in the header.
export function serializeCsrfCookie(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; Secure; SameSite=Lax; Path=/`;
}

export function verifyDoubleSubmit(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Normalises the runtimeConfig value (string at runtime, array during build/test) to a trimmed,
// non-empty string[]. Use this at every call site instead of passing cfg.allowedOrigins directly.
export function parseAllowedOrigins(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function verifyOrigin(originOrReferer: string | undefined, allowedOrigins: string[]): boolean {
  if (!originOrReferer) return false;
  let origin: string;
  try {
    origin = new URL(originOrReferer).origin;
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}
