process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
import { sql } from 'drizzle-orm';
import { toNodeListener, createApp } from 'h3';
import { db, pool } from '~/server/db/client';

export { db };

const ALL_TABLES = [
  'deliveries', 'campaigns', 'jobs', 'imports', 'devices',
  'app_ingest_keys', 'app_credentials', 'apps', 'companies',
  'audit_log', 'sessions', 'users',
];

export async function truncate(...tables: string[]) {
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}

// FK-safe full wipe used by most integration suites.
export async function resetDb() {
  await db.execute(sql.raw(`TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}

// An h3 App wired with the M1 auth handlers + guard, for black-box integration tests.
// Later milestones extend this registry; M1 wires only what it builds.
export function makeTestApp() {
  const app = createApp();
  // Routes are registered in M1.11 once the handlers exist; kept here so M2–M6 import one factory.
  return app;
}

export const listener = (app: ReturnType<typeof makeTestApp>) => toNodeListener(app);

export async function closeDb() { await pool.end(); }
