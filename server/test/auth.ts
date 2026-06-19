import { db } from '~/server/db/client';
import { users } from '~/server/db/schema';
import { hashPassword } from '~/server/utils/auth/password';

let counter = 0;

export async function seedUser(overrides: Partial<{
  email: string; password: string; role: 'admin' | 'operator'; mustChangePassword: boolean; status: 'active' | 'disabled';
}> = {}) {
  const password = overrides.password ?? 'Str0ng-Passw0rd!';
  const [u] = await db.insert(users).values({
    email: overrides.email ?? `u${counter++}-${Date.now()}@bo.com`,
    passwordHash: await hashPassword(password),
    role: overrides.role ?? 'operator',
    status: overrides.status ?? 'active',
    mustChangePassword: overrides.mustChangePassword ?? false,
  }).returning();
  return { ...u, plaintextPassword: password };
}

/**
 * Drives a black-box HTTP request against a `makeTestApp()` listener.
 *
 * Flow:
 *  1. POST /api/auth/login with `user`'s credentials → capture `bo_session` cookie.
 *  2. GET  /api/auth/csrf with the session cookie → capture `bo_csrf` cookie + token.
 *  3. Issue `path` with `method`/`body`/`headers` plus both cookies and the CSRF header.
 *
 * Returns a standard `Response`-like object (supertest response cast to Response).
 */
export async function authedFetch(
  nodeListener: (req: any, res: any) => void,
  user: { email: string; plaintextPassword: string },
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { default: request } = await import('supertest');

  // 1. Login → session cookie
  const loginRes = await request(nodeListener)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.plaintextPassword })
    .set('Content-Type', 'application/json');

  const sessionCookie = extractCookie(loginRes.headers['set-cookie'], 'bo_session');

  // 2. Fetch CSRF token
  const csrfRes = await request(nodeListener)
    .get('/api/auth/csrf')
    .set('Cookie', sessionCookie ? `bo_session=${sessionCookie}` : '');

  const csrfCookie = extractCookie(csrfRes.headers['set-cookie'], 'bo_csrf');
  const csrfToken: string = (csrfRes.body as { token: string }).token ?? '';

  // 3. Issue the actual request
  const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const cookieHeader = [
    sessionCookie ? `bo_session=${sessionCookie}` : '',
    csrfCookie ? `bo_csrf=${csrfCookie}` : '',
  ].filter(Boolean).join('; ');

  let req = request(nodeListener)[method](path)
    .set('Cookie', cookieHeader)
    .set('x-csrf-token', csrfToken)
    .set('Origin', 'http://localhost:3000');

  for (const [k, v] of Object.entries(init.headers ?? {})) {
    req = req.set(k, v);
  }
  if (init.body !== undefined) {
    req = req.send(init.body as object).set('Content-Type', 'application/json');
  }

  const res = await req;

  // Return a fetch-compatible Response shape so callers can use res.json() / res.status.
  return new Response(JSON.stringify(res.body), {
    status: res.status,
    headers: Object.fromEntries(
      Object.entries(res.headers as Record<string, string | string[]>).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
    ),
  });
}

/** Extract a named cookie value from `set-cookie` headers (string or string[]). */
function extractCookie(raw: string | string[] | undefined, name: string): string {
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const cookie of cookies) {
    const parts = cookie.split(';');
    const first = (parts[0] ?? '').trim();
    if (first.startsWith(`${name}=`)) {
      return first.slice(name.length + 1);
    }
  }
  return '';
}
