import { getCookie, getRequestHeader, getMethod, createError, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { useRuntimeConfig } from '#imports';
import { db } from '~/server/db/client';
import { users } from '~/server/db/schema';
import { readSession, SESSION_COOKIE_NAME } from '~/server/utils/auth/session';
import { verifyDoubleSubmit, verifyOrigin, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '~/server/utils/auth/csrf';

const PUBLIC_EXACT = new Set(['/api/auth/login', '/api/auth/csrf', '/healthz']);
// app-ingest device registration uses bearer-key auth, not the session (design §11).
// The middleware enforces that at least a Bearer token is present; the route handler
// is solely responsible for validating the token value.
const APP_INGEST_DEVICE = /^\/api\/apps\/[^/]+\/devices$/;
// forced first-login change: session + current-password protected, no CSRF token yet (design §11)
const CSRF_EXEMPT_EXACT = new Set(['/api/auth/change-password']);
// mustChangePassword blocks all state-changing requests except the escape hatch
const MUST_CHANGE_EXEMPT = new Set(['/api/auth/change-password']);
const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export default defineEventHandler(async (event) => {
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0];
  const method = getMethod(event);

  if (!path.startsWith('/api/') && path !== '/healthz') return;        // SSR/asset routes
  if (PUBLIC_EXACT.has(path)) return;

  // bearer-key app-ingest path: require Authorization: Bearer header as defense-in-depth;
  // the route handler validates the token value itself.
  if (method === 'POST' && APP_INGEST_DEVICE.test(path)) {
    const authHeader = getRequestHeader(event, 'authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      throw createError({ statusCode: 401, statusMessage: 'missing bearer token' });
    }
    return;
  }

  const session = await readSession(getCookie(event, SESSION_COOKIE_NAME));
  if (!session) throw createError({ statusCode: 401, statusMessage: 'unauthenticated' });

  // Fetch the user row to enforce status and mustChangePassword at the API layer.
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user || user.status !== 'active') {
    throw createError({ statusCode: 401, statusMessage: 'unauthenticated' });
  }

  if (STATE_CHANGING.has(method) && !CSRF_EXEMPT_EXACT.has(path)) {
    const cfg = useRuntimeConfig();
    const originOk = verifyOrigin(
      getRequestHeader(event, 'origin') ?? getRequestHeader(event, 'referer'),
      cfg.allowedOrigins,
    );
    const tokenOk = verifyDoubleSubmit(
      getCookie(event, CSRF_COOKIE_NAME),
      getRequestHeader(event, CSRF_HEADER_NAME),
    );
    if (!originOk || !tokenOk) throw createError({ statusCode: 403, statusMessage: 'CSRF check failed' });
  }

  // Block state-changing requests for operators with a forced password change pending.
  // GET/HEAD/OPTIONS are still allowed so the UI can bootstrap (e.g. /api/auth/me).
  // /api/auth/change-password is the only write endpoint they may reach.
  if (STATE_CHANGING.has(method) && user.mustChangePassword && !MUST_CHANGE_EXEMPT.has(path)) {
    throw createError({ statusCode: 403, statusMessage: 'password change required' });
  }

  event.context.user = { id: user.id, mustChangePassword: user.mustChangePassword };
});
