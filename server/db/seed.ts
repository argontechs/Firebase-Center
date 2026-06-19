import { sql } from 'drizzle-orm';
import { db } from './client';
import { users } from './schema';
import { hashPassword } from '~/server/utils/auth/password';
import { audit } from '~/server/utils/audit';

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

export function validatePasswordStrength(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < 12) return { ok: false, reason: 'must be at least 12 characters' };
  if (!/[a-z]/.test(pw)) return { ok: false, reason: 'must contain a lowercase letter' };
  if (!/[A-Z]/.test(pw)) return { ok: false, reason: 'must contain an uppercase letter' };
  if (!/[0-9]/.test(pw)) return { ok: false, reason: 'must contain a digit' };
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, reason: 'must contain a symbol' };
  return { ok: true };
}

/** Resolve env vars, supporting both bare keys (tests/direct callers) and
 *  the NUXT_-prefixed keys that Docker / Nuxt runtimeConfig injects. */
function resolveEnv(
  env: { BO_ADMIN_EMAIL?: string; BO_ADMIN_PASSWORD?: string } = {
    BO_ADMIN_EMAIL: process.env.NUXT_BO_ADMIN_EMAIL ?? process.env.BO_ADMIN_EMAIL,
    BO_ADMIN_PASSWORD: process.env.NUXT_BO_ADMIN_PASSWORD ?? process.env.BO_ADMIN_PASSWORD,
  },
) {
  return env;
}

export async function seedFirstAdmin(
  env?: { BO_ADMIN_EMAIL?: string; BO_ADMIN_PASSWORD?: string },
): Promise<{ seeded: boolean }> {
  const resolved = resolveEnv(env);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count > 0) return { seeded: false };

  const email = resolved.BO_ADMIN_EMAIL;
  const password = resolved.BO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new SeedError(
      'users table is empty and BO_ADMIN_EMAIL / BO_ADMIN_PASSWORD are not set — refusing to boot unloginnable',
    );
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw new SeedError(`BO_ADMIN_PASSWORD ${strength.reason}`);
  }
  const [inserted] = await db.insert(users).values({
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    role: 'admin',
    status: 'active',
    mustChangePassword: true,
  }).returning({ id: users.id });
  await audit({ userId: inserted.id, action: 'user_create', targetType: 'user', targetId: inserted.id });
  return { seeded: true };
}

// CLI entrypoint: `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedFirstAdmin()
    .then((r) => {
      console.log(`[seed] first-admin seeded=${r.seeded}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[seed] ${err.message}`);
      process.exit(1);
    });
}
