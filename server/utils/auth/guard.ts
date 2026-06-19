import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { getCookie, getRequestHeader, createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { readSession, SESSION_COOKIE_NAME } from './session';
import { verifyDoubleSubmit, verifyOrigin, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './csrf';

// 401 unless a valid (non-expired) session cookie is present.
export async function requireSession(event: H3Event): Promise<{ userId: string }> {
  const session = await readSession(getCookie(event, SESSION_COOKIE_NAME));
  if (!session) throw createError({ statusCode: 401, statusMessage: 'unauthenticated' });
  return session;
}

// 401 unless a valid session AND an active user row; returns the row (incl. role).
export async function requireUser(event: H3Event): Promise<typeof users.$inferSelect> {
  const { userId } = await requireSession(event);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== 'active') throw createError({ statusCode: 401, statusMessage: 'unauthenticated' });
  return user;
}

// 403 unless the double-submit token matches AND the origin/referer is allow-listed.
export function assertCsrf(event: H3Event): void {
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

// Alias: some milestones referenced `requireCsrf`; it is the same guard as `assertCsrf`.
export const requireCsrf = assertCsrf;
