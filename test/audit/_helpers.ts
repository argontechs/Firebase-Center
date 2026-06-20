/**
 * M7.3 audit-coverage test harness.
 *
 * Defines:
 *  - `seedAdminAndApp()` — seeds a minimal DB fixture (admin, operator, company, app,
 *    credential, ingest key, send key) for use across the M7 coverage suite.
 *  - `makeEvt()` — builds a plain-object stub event compatible with the vi.mock('h3')
 *    shim defined in coverage.test.ts.
 *  - `invokeRouteEmittingAudit(action, ctx)` — dynamically imports and calls the
 *    handler responsible for each AuditAction, driving the audit() spy.
 *
 * Design notes:
 *  - All handler imports are dynamic so the hoisted vi.mock() calls in
 *    coverage.test.ts are active before any handler module graph resolves.
 *  - The vi.mock('h3') shim maps: readBody→_body, getRouterParam→_params[n],
 *    getCookie→_cookies[n], getRequestHeader/getHeader→_headers[n.toLowerCase()].
 *  - The vi.mock for guard/require-admin returns the admin user from _user,
 *    so no real session infrastructure is needed for most handlers.
 *  - logout.post is the exception: it reads the session cookie itself and calls
 *    readSession directly, so we seed a real session and pass its id in _cookies.
 */
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

import { randomBytes, createHash } from 'node:crypto';
import { db } from '~~/server/db/client';
import {
  users, companies, apps, appCredentials, appIngestKeys, siteSendKeys,
} from '~~/server/db/schema';
import { hashPassword } from '~~/server/utils/auth/password';
import { encryptSecret } from '~~/server/utils/crypto';
import type { AuditAction } from '~~/server/utils/audit';

// ---- Seed helpers ----

export interface SeedCtx {
  admin: {
    id: string; email: string; role: 'admin'; plaintextPassword: string;
    passwordHash: string; status: 'active'; mustChangePassword: boolean; createdAt: Date;
  };
  operator: { id: string; email: string; role: 'operator'; plaintextPassword: string };
  company: { id: string };
  app: { id: string };
  credential: { id: string };
  ingestKey: { id: string };
  sendKey: { id: string; fullKey: string };
}

/**
 * Seeds a minimal fixture. Unique per-call via a random suffix so tests can
 * run in parallel without key-constraint collisions.
 */
export async function seedAdminAndApp(): Promise<SeedCtx> {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adminPw = 'Adminpassw0rd!';
  const opPw = 'Operpassw0rd!';

  const [admin] = await db.insert(users).values({
    email: `admin-${ts}@cov.io`,
    passwordHash: await hashPassword(adminPw),
    role: 'admin',
    status: 'active',
    mustChangePassword: false,
  }).returning();

  const [operator] = await db.insert(users).values({
    email: `op-${ts}@cov.io`,
    passwordHash: await hashPassword(opPw),
    role: 'operator',
    status: 'active',
    mustChangePassword: false,
  }).returning();

  const [company] = await db.insert(companies).values({ name: `AuditCo-${ts}` }).returning();
  const [app] = await db.insert(apps).values({ companyId: company.id, name: `AuditApp-${ts}` }).returning();

  // Credential (FCM/android) — encrypt a dummy secret
  const enc = encryptSecret(JSON.stringify({ project_id: 'test-proj', type: 'service_account' }));
  const [credential] = await db.insert(appCredentials).values({
    appId: app.id,
    provider: 'fcm',
    platform: 'android',
    secretCiphertext: enc.ciphertext,
    secretNonce: enc.nonce,
    secretTag: enc.tag,
    keyVersion: enc.keyVersion,
    metaJsonb: { project_id: 'test-proj' },
  }).returning();

  // Ingest key
  const rawIngest = randomBytes(24).toString('base64url');
  const ingestHash = createHash('sha256').update(`fcik_test_${rawIngest}`).digest('hex');
  const [ingestKey] = await db.insert(appIngestKeys).values({
    appId: app.id,
    keyHash: ingestHash,
    keyPrefix: 'fcik_test',
    version: 1,
  }).returning();

  // Send key — mint a real key so v1/messages.post can resolve it
  const rawSend = 'bo_sk_' + randomBytes(24).toString('base64url');
  const sendHash = createHash('sha256').update(rawSend).digest('hex');
  const sendPrefix = rawSend.slice(0, 12);
  const [sendKeyRow] = await db.insert(siteSendKeys).values({
    companyId: company.id,
    keyHash: sendHash,
    keyPrefix: sendPrefix,
    version: 1,
  }).returning();

  return {
    admin: {
      id: admin.id,
      email: admin.email,
      role: 'admin',
      plaintextPassword: adminPw,
      passwordHash: admin.passwordHash,
      status: 'active',
      mustChangePassword: false,
      createdAt: admin.createdAt,
    },
    operator: { id: operator.id, email: operator.email, role: 'operator', plaintextPassword: opPw },
    company: { id: company.id },
    app: { id: app.id },
    credential: { id: credential.id },
    ingestKey: { id: ingestKey.id },
    sendKey: { id: sendKeyRow.id, fullKey: rawSend },
  };
}

// ---- Stub event factory ----

/**
 * Builds a plain-object stub event.
 *
 * Compatible with the vi.mock('h3') shim in coverage.test.ts:
 *   getCookie(e, name)         → e._cookies[name]
 *   getRouterParam(e, name)    → e._params[name]
 *   readBody(e)                → e._body
 *   getRequestHeader(e, name)  → e._headers[name.toLowerCase()]
 *   getHeader(e, name)         → e._headers[name.toLowerCase()]
 *   getRequestIP(e, _opts)     → e._ip ?? '127.0.0.1'
 *   setResponseStatus(e, code) → e._status = code
 *   setResponseHeader(e, k, v) → e._res[k] = v
 *   readMultipartFormData(e)   → e._multipart ?? null
 *
 * _user and _session are consumed by the guard mocks (requireUser / requireSession /
 * requireAdmin / assertCsrf) defined in coverage.test.ts.
 */
export function makeEvt(opts: {
  body?: unknown;
  params?: Record<string, string>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  multipart?: unknown;
  user?: Record<string, unknown> | null;
  session?: { userId: string } | null;
  ip?: string;
}): any {
  return {
    _body: opts.body ?? {},
    _params: opts.params ?? {},
    _cookies: opts.cookies ?? {},
    _headers: {
      origin: 'http://localhost:3000',
      'x-csrf-token': 'test-csrf',
      'x-forwarded-for': opts.ip ?? '127.0.0.1',
      ...(opts.headers ?? {}),
    },
    _multipart: opts.multipart ?? null,
    _user: opts.user ?? null,
    _session: opts.session ?? null,
    _ip: opts.ip ?? '127.0.0.1',
    _status: null,
    _res: {},
    // Minimal node.req stub so code paths that access event.node.req.socket.remoteAddress
    // (e.g. server/utils/http.ts#clientIp) don't throw.
    node: { req: { socket: { remoteAddress: opts.ip ?? '127.0.0.1' } } },
  };
}

// ---- Route exerciser ----

/**
 * Imports the handler responsible for `action` and calls it with a stub event
 * that satisfies the handler's minimal input contract, triggering the audit() call.
 *
 * Preconditions:
 *  - vi.mock('h3') is active (coverage.test.ts sets this up via hoisted mocks).
 *  - vi.mock for guard/require-admin is active, returning ctx.admin from _user/_session.
 *  - ctx was returned by seedAdminAndApp() within the same test.
 */
export async function invokeRouteEmittingAudit(action: AuditAction, ctx: SeedCtx): Promise<void> {
  // Shorthand: build the full admin user object that guard mocks return.
  const adminUser = {
    id: ctx.admin.id,
    email: ctx.admin.email,
    role: ctx.admin.role,
    passwordHash: ctx.admin.passwordHash,
    status: ctx.admin.status,
    mustChangePassword: ctx.admin.mustChangePassword,
    createdAt: ctx.admin.createdAt,
  };

  switch (action) {
    case 'login_success': {
      const { default: handler } = await import('~~/server/api/auth/login.post');
      await handler(makeEvt({ body: { email: ctx.admin.email, password: ctx.admin.plaintextPassword } }));
      return;
    }

    case 'login_failure': {
      const { default: handler } = await import('~~/server/api/auth/login.post');
      await handler(makeEvt({ body: { email: ctx.admin.email, password: 'WrongPassword1!' } })).catch(() => {});
      return;
    }

    case 'logout': {
      // logout.post reads the session cookie itself (getCookie → _cookies[SESSION_COOKIE_NAME])
      // and calls readSession directly — so we need a real session row, not just a guard mock.
      const { createSession, SESSION_COOKIE_NAME } = await import('~~/server/utils/auth/session');
      const { sessionId } = await createSession(ctx.admin.id);
      const { default: handler } = await import('~~/server/api/auth/logout.post');
      await handler(makeEvt({ cookies: { [SESSION_COOKIE_NAME]: sessionId } }));
      return;
    }

    case 'password_change': {
      const { default: handler } = await import('~~/server/api/auth/change-password.post');
      await handler(makeEvt({
        body: { currentPassword: ctx.admin.plaintextPassword, newPassword: 'NewPassw0rd!x1' },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'user_create': {
      const { default: handler } = await import('~~/server/api/users/index.post');
      const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await handler(makeEvt({
        body: { email: `created-${ts}@cov.io`, role: 'operator', password: 'Created-Str0ng!1' },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'user_disable': {
      const { default: handler } = await import('~~/server/api/users/[id]/disable.post');
      await handler(makeEvt({
        params: { id: ctx.operator.id },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'role_change': {
      const { default: handler } = await import('~~/server/api/users/[id]/index.patch');
      await handler(makeEvt({
        params: { id: ctx.operator.id },
        body: { role: 'admin' },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'master_key_rotation': {
      const { default: handler } = await import('~~/server/api/admin/master-key/rotate.post');
      await handler(makeEvt({ user: adminUser, session: { userId: ctx.admin.id } }));
      return;
    }

    case 'ingest_key_issue': {
      const { default: handler } = await import('~~/server/api/apps/[id]/ingest-keys/index.post');
      await handler(makeEvt({
        params: { id: ctx.app.id },
        body: { label: 'cov-key' },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'ingest_key_revoke': {
      const { default: handler } = await import('~~/server/api/apps/[id]/ingest-keys/[kid]/revoke.post');
      await handler(makeEvt({
        params: { id: ctx.app.id, kid: ctx.ingestKey.id },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'credential_save': {
      const { default: handler } = await import('~~/server/api/apps/[id]/credentials.post');
      await handler(makeEvt({
        params: { id: ctx.app.id },
        body: {
          provider: 'huawei',
          platform: 'huawei',
          secret: JSON.stringify({ appId: 'huawei-app', appSecret: 'huawei-sec' }),
          meta: { push_kit_enabled: true },
        },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'credential_rotate': {
      const { default: handler } = await import('~~/server/api/apps/[id]/credentials/[cid]/rotate.post');
      await handler(makeEvt({
        params: { id: ctx.app.id, cid: ctx.credential.id },
        body: { secret: JSON.stringify({ project_id: 'rotated', type: 'service_account' }) },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'campaign_send': {
      const { default: handler } = await import('~~/server/api/campaigns/index.post');
      await handler(makeEvt({
        body: {
          appId: ctx.app.id,
          title: 'Coverage test',
          body: 'Coverage body',
          data: {},
          mode: 'notification',
          priority: 'high',
          targetType: 'all',
          targetValue: {},
          providerScope: 'both',
        },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'import_run': {
      const { default: handler } = await import('~~/server/api/apps/[id]/imports.post');
      // readMultipartFormData is mocked to return minimal CSV parts via _multipart.
      await handler(makeEvt({
        params: { id: ctx.app.id },
        multipart: [
          { name: 'file', filename: 'devices.csv', data: Buffer.from('token,provider,platform\nTK1,fcm,android\n') },
          { name: 'format', data: Buffer.from('csv') },
          { name: 'mapping', data: Buffer.from(JSON.stringify({ token: 'token', provider: 'provider', platform: 'platform' })) },
        ],
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'send_key_issue': {
      const { default: handler } = await import('~~/server/api/companies/[id]/send-keys/index.post');
      await handler(makeEvt({
        params: { id: ctx.company.id },
        body: { label: 'cov-send-key' },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'send_key_rotate': {
      const { default: handler } = await import('~~/server/api/companies/[id]/send-keys/[kid]/rotate.post');
      await handler(makeEvt({
        params: { id: ctx.company.id, kid: ctx.sendKey.id },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'send_key_revoke': {
      // Issue a fresh key dedicated to revocation (ctx.sendKey may be consumed by rotate).
      const { issueSendKey } = await import('~~/server/utils/send-keys');
      const fresh = await issueSendKey(db, ctx.company.id, ctx.admin.id, 'revoke-target');
      const { default: handler } = await import('~~/server/api/companies/[id]/send-keys/[kid]/revoke.post');
      await handler(makeEvt({
        params: { id: ctx.company.id, kid: fresh.id },
        user: adminUser,
        session: { userId: ctx.admin.id },
      }));
      return;
    }

    case 'api_send': {
      // v1/messages.post resolves the send key from the Authorization header (not a session).
      // The mock for getHeader reads _headers['authorization'].
      const { default: handler } = await import('~~/server/api/v1/messages.post');
      await handler(makeEvt({
        body: {
          appId: ctx.app.id,
          target: { type: 'all' },
          notification: { title: 'API test', body: 'API body' },
          data: {},
          mode: 'notification',
          priority: 'high',
        },
        headers: { authorization: `Bearer ${ctx.sendKey.fullKey}` },
        ip: '127.0.0.1',
      }));
      return;
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`invokeRouteEmittingAudit: unhandled action '${_exhaustive}'`);
    }
  }
}
