import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db, truncate, closeDb } from '~/server/test/db';
import { seedUser } from '~/server/test/auth';
import {
  createSession, readSession, destroySession, destroyAllSessionsForUser,
  serializeSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME,
  IDLE_TIMEOUT_MS,
} from './session';

beforeEach(async () => { await truncate('sessions', 'users'); });
afterAll(async () => { await closeDb(); });

describe('session', () => {
  it('creates a readable session', async () => {
    const { id: uid } = await seedUser();
    const { sessionId } = await createSession(uid);
    expect(await readSession(sessionId)).toEqual({ userId: uid });
  });

  it('returns null for an unknown or undefined id', async () => {
    expect(await readSession(undefined)).toBeNull();
    expect(await readSession('nope')).toBeNull();
  });

  it('destroy removes the session', async () => {
    const { id: uid } = await seedUser();
    const { sessionId } = await createSession(uid);
    await destroySession(sessionId);
    expect(await readSession(sessionId)).toBeNull();
  });

  it('destroyAllSessionsForUser kills every session (password change)', async () => {
    const { id: uid } = await seedUser();
    const a = await createSession(uid);
    const b = await createSession(uid);
    await destroyAllSessionsForUser(uid);
    expect(await readSession(a.sessionId)).toBeNull();
    expect(await readSession(b.sessionId)).toBeNull();
  });

  it('expires after idle timeout', async () => {
    const { id: uid } = await seedUser();
    const { sessionId } = await createSession(uid);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + IDLE_TIMEOUT_MS + 1000);
    expect(await readSession(sessionId)).toBeNull();
    vi.useRealTimers();
  });

  it('serializes a hardened cookie and a clearing cookie', () => {
    const c = serializeSessionCookie('abc', 3600);
    expect(c).toContain(`${SESSION_COOKIE_NAME}=abc`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });
});
