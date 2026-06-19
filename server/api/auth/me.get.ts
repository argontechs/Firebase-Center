import { defineEventHandler, getCookie, setResponseHeader } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { SESSION_COOKIE_NAME, IDLE_TIMEOUT_MS, serializeSessionCookie } from '~~/server/utils/auth/session';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);   // throws 401 when no session / disabled

  // Re-emit the session cookie on every authenticated response to implement the
  // sliding idle-timeout window. Without this, the browser drops the cookie
  // IDLE_TIMEOUT_MS after *login* regardless of activity — the DB lastSeenAt
  // slides correctly but the client-side Max-Age does not reset.
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);
  if (sessionId) {
    setResponseHeader(event, 'Set-Cookie', serializeSessionCookie(sessionId, Math.floor(IDLE_TIMEOUT_MS / 1000)));
  }

  return { user: { id: user.id, email: user.email, role: user.role }, mustChangePassword: user.mustChangePassword };
});
