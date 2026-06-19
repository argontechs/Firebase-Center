process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
import { sql } from 'drizzle-orm';
import { toNodeListener, createApp, createRouter, eventHandler } from 'h3';
import { db, pool } from '~~/server/db/client';

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
export async function makeTestApp() {
  // Dynamic imports so the module graph resolves after #imports stub is in place.
  const [
    { default: guardMiddleware },
    { default: loginPost },
    { default: meGet },
    { default: logoutPost },
    { default: changePasswordPost },
    { default: csrfGet },
  ] = await Promise.all([
    import('~~/server/middleware/auth'),
    import('~~/server/api/auth/login.post'),
    import('~~/server/api/auth/me.get'),
    import('~~/server/api/auth/logout.post'),
    import('~~/server/api/auth/change-password.post'),
    import('~~/server/api/auth/csrf.get'),
  ]);

  const app = createApp();
  app.use(eventHandler(guardMiddleware));   // global guard runs first

  const router = createRouter();
  router.post('/api/auth/login', eventHandler(loginPost));
  router.get('/api/auth/me', eventHandler(meGet));
  router.post('/api/auth/logout', eventHandler(logoutPost));
  router.post('/api/auth/change-password', eventHandler(changePasswordPost));
  router.get('/api/auth/csrf', eventHandler(csrfGet));
  app.use(router);

  return app;
}

export const listener = async () => toNodeListener(await makeTestApp());

export async function closeDb() { await pool.end(); }
