import { db } from './client';

/**
 * Canonical loud-fail type for the first-admin seed. Thrown here AND extended (not replaced)
 * by M1.6, so the entrypoint path and M1.11's integration assertion
 * (`rejects.toBeInstanceOf(SeedError)`) stay consistent across milestones.
 */
export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

/**
 * First-admin seed (design §11). Idempotent: seeds ONLY when the users table is empty;
 * later boots never reset an existing admin. If users is empty AND BO_ADMIN_* are unset,
 * fails loudly (SeedError) rather than coming up unloginnable.
 *
 * NOTE (M0): password hashing + the actual users-row insert land in M1.6, which EXTENDS this
 * file in place. The export surface here — SeedError, this signature, the empty-table check,
 * the /BO_ADMIN/ message, and the _countUsers test hook — is fixed; M1.6 only fills the
 * hashing-deferred `{ seeded: true }` branch and adds validatePasswordStrength.
 */
export async function seedFirstAdmin(): Promise<{ seeded: boolean }> {
  // Count via the injected helper in tests; real impl uses a select count.
  const anyDb = db as unknown as { _countUsers?: () => Promise<number> };
  const count = anyDb._countUsers
    ? await anyDb._countUsers()
    : await realUserCount();

  if (count > 0) {
    return { seeded: false };
  }

  const email = process.env.NUXT_BO_ADMIN_EMAIL;
  const password = process.env.NUXT_BO_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new SeedError(
      'Refusing to boot: users table is empty but NUXT_BO_ADMIN_EMAIL / NUXT_BO_ADMIN_PASSWORD are unset. ' +
        'Set the first-admin credentials so the BO comes up loginnable.',
    );
  }

  // M1.6 will hash `password` (argon2id) and insert the users row here.
  return { seeded: true };
}

async function realUserCount(): Promise<number> {
  const { users } = await import('./schema');
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
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
