/**
 * Shared test-harness factory for API integration tests.
 *
 * `setupApiTest()` spins up the test app, seeds one operator user, and
 * returns a context object with:
 *   - `db`        – the shared Drizzle db instance (already reset)
 *   - `$fetch`    – authenticated fetch (operator session + CSRF)
 *   - `anonFetch` – unauthenticated fetch (throws on 4xx/5xx)
 */

process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';

export { db, closeDb };

type FetchInit = { method?: string; body?: unknown; headers?: Record<string, string> };

export async function setupApiTest() {
  const app = await makeTestApp();
  await resetDb();
  const user = await seedUser();
  const fetch = authedFetch(app.nodeListener, user);

  async function anonFetch(path: string, init: FetchInit = {}): Promise<unknown> {
    const { default: request } = await import('supertest');
    const method = ((init.method ?? 'GET').toLowerCase()) as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(app.nodeListener)[method](path);
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      req = req.set(k, v);
    }
    if (init.body !== undefined) {
      req = req.send(init.body as object).set('Content-Type', 'application/json');
    }
    const res = await req;
    if (res.status >= 400) {
      const err = Object.assign(new Error(res.body?.statusMessage ?? String(res.status)), {
        statusCode: res.status,
        data: res.body,
      });
      throw err;
    }
    return res.body;
  }

  return { db, app, $fetch: fetch, anonFetch };
}
