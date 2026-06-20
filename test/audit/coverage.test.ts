/**
 * M7.3 — Audit taxonomy coverage
 *
 * Asserts that every value in the AuditAction union is emitted by its route handler.
 *
 * Strategy:
 *  - vi.mock('~~/server/utils/audit') replaces audit() with a spy so we can assert
 *    which actions were recorded without touching the real DB audit_log table.
 *  - vi.mock('h3') stubs body/params/cookie/status helpers so handlers can run
 *    against plain-object events without a real HTTP server.
 *  - vi.mock for guard/require-admin bypasses session validation, returning the
 *    seeded admin user from event._user.
 *  - vi.mock for readMultipartFormData returns event._multipart so the import route
 *    receives a pre-parsed multipart body without a real HTTP multipart stream.
 *  - The real Drizzle client against the test Postgres DB is used for all other
 *    persistence (campaigns, credentials, etc.) so the handlers exercise real SQL.
 *
 * IMPORTANT: NUXT_DATABASE_URL must be set before any module that imports db/client.
 * Both this file and _helpers.ts set it via ??= at the top level. Since vi.mock calls
 * are hoisted but the process.env assignment runs first in module evaluation order,
 * this guarantees the DB URL is available when server/test/db.ts imports db/client.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (!process.env.NUXT_DATABASE_URL) {
  process.env.NUXT_DATABASE_URL = 'postgres://fc:fc@localhost:55432/firebase_center_test';
}
// Required by encryptSecret / decryptSecret in crypto.ts (called during seedAdminAndApp and
// the credential_save / credential_rotate / master_key_rotation route handlers).
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AuditAction } from '~~/server/utils/audit';

// ---- Mock: audit spy ----
// Must be hoisted before any handler import. Spy replaces the real audit() while
// keeping all other exports (type AuditAction) from the real module.
const auditSpy = vi.fn(async () => {});
vi.mock('~~/server/utils/audit', async (orig) => {
  const real = await orig<typeof import('~~/server/utils/audit')>();
  return { ...real, audit: auditSpy };
});

// ---- Mock: h3 helpers ----
// Maps each h3 helper used by route handlers onto corresponding _* fields on the
// stub event object returned by makeEvt() in _helpers.ts.
vi.mock('h3', () => ({
  readBody: async (e: any) => e._body,
  getRouterParam: (e: any, n: string) => e._params?.[n],
  getCookie: (e: any, n: string) => e._cookies?.[n],
  getRequestHeader: (e: any, n: string) => e._headers?.[n.toLowerCase()],
  getHeader: (e: any, n: string) => e._headers?.[n.toLowerCase()],
  getRequestIP: (e: any, _opts?: any) => e._ip ?? '127.0.0.1',
  setResponseHeader: (e: any, k: string, v: string) => { e._res ??= {}; e._res[k] = v; },
  setResponseStatus: (e: any, s: number) => { e._status = s; },
  readMultipartFormData: async (e: any) => e._multipart ?? null,
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? String(o.statusCode ?? 'error')), o),
  defineEventHandler: (fn: any) => fn,
}));

// ---- Mock: Nuxt #imports ----
// Needed so guard.ts / csrf.ts can call useRuntimeConfig() without a Nuxt runtime.
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ allowedOrigins: ['http://localhost:3000'] }),
}), { virtual: true });

// ---- Mock: auth guard ----
// requireUser / requireSession return event._user / event._session so each handler
// gets a valid user object without a real session cookie round-trip.
// assertCsrf is a no-op — CSRF validation would always fail on stub events.
vi.mock('~~/server/utils/auth/guard', async (orig) => {
  const real = await orig<typeof import('~~/server/utils/auth/guard')>();
  return {
    ...real,
    requireUser: async (e: any) => {
      if (!e._user) {
        const err: any = new Error('unauthenticated');
        err.statusCode = 401;
        throw err;
      }
      return e._user;
    },
    requireSession: async (e: any) => {
      if (!e._session) {
        const err: any = new Error('unauthenticated');
        err.statusCode = 401;
        throw err;
      }
      return e._session;
    },
    assertCsrf: () => { /* no-op in tests */ },
    requireCsrf: () => { /* no-op in tests */ },
  };
});

// ---- Mock: require-admin ----
// Delegates to event._user and asserts role='admin', mirroring the real implementation
// without the session overhead.
vi.mock('~~/server/utils/auth/require-admin', async (orig) => {
  const real = await orig<typeof import('~~/server/utils/auth/require-admin')>();
  return {
    ...real,
    requireAdmin: async (e: any) => {
      if (!e._user) {
        const err: any = new Error('unauthenticated');
        err.statusCode = 401;
        throw err;
      }
      if (e._user.role !== 'admin') {
        const err: any = new Error('admin only');
        err.statusCode = 403;
        throw err;
      }
      return e._user;
    },
  };
});

// ---- Mock: rate-limit (used by v1/messages and login) ----
// Suppress sliding-window state that leaks across tests.
vi.mock('~~/server/utils/rate-limit', () => ({
  rateLimit: () => { /* no-op */ },
}));

// ---- Imports (after mocks) ----
import { resetDb, closeDb } from '~~/server/test/db';
import { seedAdminAndApp, invokeRouteEmittingAudit } from './_helpers';
import { resetRateLimitStore } from '~~/server/utils/auth/rate-limit';

// ---- Test ----

const ALL_ACTIONS: AuditAction[] = [
  'login_success',
  'login_failure',
  'logout',
  'password_change',
  'user_create',
  'user_disable',
  'role_change',
  'master_key_rotation',
  'ingest_key_issue',
  'ingest_key_revoke',
  'credential_save',
  'credential_rotate',
  'campaign_send',
  'import_run',
  'send_key_issue',
  'send_key_rotate',
  'send_key_revoke',
  'api_send',
];

describe('audit taxonomy coverage', () => {
  beforeEach(async () => {
    await resetDb();
    auditSpy.mockClear();
    resetRateLimitStore();
  });

  afterAll(async () => {
    await closeDb();
  });

  it.each(ALL_ACTIONS)('emits %s from its route', async (action) => {
    const ctx = await seedAdminAndApp();
    await invokeRouteEmittingAudit(action, ctx);
    const emitted = auditSpy.mock.calls.map((c) => c[0].action as AuditAction);
    expect(emitted).toContain(action);
  });
});
