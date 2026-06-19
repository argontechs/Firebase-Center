import { getCookie, setResponseHeader, setResponseStatus, defineEventHandler } from 'h3';
import { readSession, destroySession, clearSessionCookie, SESSION_COOKIE_NAME } from '~~/server/utils/auth/session';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);
  if (sessionId) {
    const session = await readSession(sessionId);
    await destroySession(sessionId);
    if (session) await audit({ userId: session.userId, action: 'logout', targetType: 'user', targetId: session.userId });
  }
  setResponseHeader(event, 'Set-Cookie', clearSessionCookie());
  setResponseStatus(event, 204);
  return null;
});
