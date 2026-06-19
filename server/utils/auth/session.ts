import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '~/server/db/client';
import { sessions } from '~/server/db/schema';

export const SESSION_COOKIE_NAME = 'bo_session';
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;          // 30 min sliding
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 h hard cap

export async function createSession(userId: string): Promise<{ sessionId: string; cookie: string }> {
  const sessionId = randomBytes(32).toString('base64url');
  const absoluteExpiry = new Date(Date.now() + ABSOLUTE_TIMEOUT_MS);
  await db.insert(sessions).values({ id: sessionId, userId, absoluteExpiry });
  return { sessionId, cookie: serializeSessionCookie(sessionId, Math.floor(IDLE_TIMEOUT_MS / 1000)) };
}

export async function readSession(sessionId: string | undefined): Promise<{ userId: string } | null> {
  if (!sessionId) return null;
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - IDLE_TIMEOUT_MS);
  const rows = await db.select().from(sessions).where(
    and(eq(sessions.id, sessionId), gt(sessions.lastSeenAt, idleCutoff), gt(sessions.absoluteExpiry, now)),
  );
  const row = rows[0];
  if (!row) return null;
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
  return { userId: row.userId };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function serializeSessionCookie(sessionId: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
