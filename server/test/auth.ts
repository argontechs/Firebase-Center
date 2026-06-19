import { db } from '~/server/db/client';
import { users } from '~/server/db/schema';
import { hashPassword } from '~/server/utils/auth/password';

let counter = 0;

export async function seedUser(overrides: Partial<{
  email: string; password: string; role: 'admin' | 'operator'; mustChangePassword: boolean; status: 'active' | 'disabled';
}> = {}) {
  const password = overrides.password ?? 'Str0ng-Passw0rd!';
  const [u] = await db.insert(users).values({
    email: overrides.email ?? `u${counter++}-${Date.now()}@bo.com`,
    passwordHash: await hashPassword(password),
    role: overrides.role ?? 'operator',
    status: overrides.status ?? 'active',
    mustChangePassword: overrides.mustChangePassword ?? false,
  }).returning();
  return { ...u, plaintextPassword: password };
}

// Logs `user` in against a makeTestApp() listener, then replays the session + CSRF
// cookies/headers on the supplied request. Used by M2–M6 route tests.
export async function authedFetch(
  listener: (req: any, res: any) => void,
  user: { email: string; plaintextPassword: string },
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { fetch } = await import('node:test/helpers').catch(() => ({ fetch: globalThis.fetch }));
  void fetch; // implementation note: M2 provides the concrete supertest-style driver; signature is the contract
  throw new Error('authedFetch is wired in M1.11 makeTestApp(); see integration suite');
}
