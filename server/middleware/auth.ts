import { getCookie, getRequestHeader, getMethod, createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { readSession, SESSION_COOKIE_NAME } from '~/server/utils/auth/session';
import { verifyDoubleSubmit, verifyOrigin, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '~/server/utils/auth/csrf';

const PUBLIC_EXACT = new Set(['/api/auth/login', '/api/auth/csrf', '/healthz']);
// app-ingest device registration uses bearer-key auth, not the session (design §11)
const APP_INGEST_DEVICE = /^\/api\/apps\/[^/]+\/devices$/;
// forced first-login change: session + current-password protected, no CSRF token yet (design §11)
const CSRF_EXEMPT_EXACT = new Set(['/api/auth/change-password']);
const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export default defineEventHandler(async (event) => {
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0];
  const method = getMethod(event);

  if (!path.startsWith('/api/') && path !== '/healthz') return;        // SSR/asset routes
  if (PUBLIC_EXACT.has(path)) return;
  if (method === 'POST' && APP_INGEST_DEVICE.test(path)) return;        // bearer-key path, exempt

  const session = await readSession(getCookie(event, SESSION_COOKIE_NAME));
  if (!session) throw createError({ statusCode: 401, statusMessage: 'unauthenticated' });

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

  event.context.user = { id: session.userId };
});
