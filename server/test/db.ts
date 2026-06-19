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
    // M2.2: company CRUD
    { default: companiesGet },
    { default: companiesPost },
    { default: companyGet },
    { default: companyPatch },
    { default: companyDelete },
    // M2.3: app CRUD
    { default: appsGet },
    { default: appsPost },
    { default: appGet },
    { default: appPatch },
    { default: appDelete },
    // M3.9: credential import
    { default: credentialsImportPost },
    // M4.3: device import per app
    { default: appImportsPost },
  ] = await Promise.all([
    import('~~/server/middleware/auth'),
    import('~~/server/api/auth/login.post'),
    import('~~/server/api/auth/me.get'),
    import('~~/server/api/auth/logout.post'),
    import('~~/server/api/auth/change-password.post'),
    import('~~/server/api/auth/csrf.get'),
    // M2.2
    import('~~/server/api/companies/index.get'),
    import('~~/server/api/companies/index.post'),
    import('~~/server/api/companies/[id].get'),
    import('~~/server/api/companies/[id].patch'),
    import('~~/server/api/companies/[id].delete'),
    // M2.3
    import('~~/server/api/apps/index.get'),
    import('~~/server/api/apps/index.post'),
    import('~~/server/api/apps/[id].get'),
    import('~~/server/api/apps/[id].patch'),
    import('~~/server/api/apps/[id].delete'),
    // M3.9
    import('~~/server/api/imports/credentials.post'),
    // M4.3
    import('~~/server/api/apps/[id]/imports.post'),
  ]);

  const app = createApp();
  app.use(eventHandler(guardMiddleware));   // global guard runs first

  const router = createRouter();
  router.post('/api/auth/login', eventHandler(loginPost));
  router.get('/api/auth/me', eventHandler(meGet));
  router.post('/api/auth/logout', eventHandler(logoutPost));
  router.post('/api/auth/change-password', eventHandler(changePasswordPost));
  router.get('/api/auth/csrf', eventHandler(csrfGet));
  // M2.2: company CRUD
  router.get('/api/companies', eventHandler(companiesGet));
  router.post('/api/companies', eventHandler(companiesPost));
  router.get('/api/companies/:id', eventHandler(companyGet));
  router.patch('/api/companies/:id', eventHandler(companyPatch));
  router.delete('/api/companies/:id', eventHandler(companyDelete));
  // M2.3: app CRUD
  router.get('/api/apps', eventHandler(appsGet));
  router.post('/api/apps', eventHandler(appsPost));
  router.get('/api/apps/:id', eventHandler(appGet));
  router.patch('/api/apps/:id', eventHandler(appPatch));
  router.delete('/api/apps/:id', eventHandler(appDelete));
  // M3.9: credential import
  router.post('/api/imports/credentials', eventHandler(credentialsImportPost));
  // M4.3: device import per app
  router.post('/api/apps/:id/imports', eventHandler(appImportsPost));
  app.use(router);

  const nodeListener = toNodeListener(app);

  // Attach a $fetch helper for unauthenticated black-box requests in tests.
  async function $fetch(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const { default: request } = await import('supertest');
    const method = ((init.method ?? 'GET').toLowerCase()) as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(nodeListener)[method](path);
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      req = req.set(k, v);
    }
    if (init.body !== undefined) {
      req = req.send(init.body as object).set('Content-Type', 'application/json');
    }
    const res = await req;
    if (res.status >= 400) {
      const err = Object.assign(new Error(res.body?.statusMessage ?? String(res.status)), {
        statusCode: res.status,
        data: res.body,
      });
      throw err;
    }
    return res.body;
  }

  return Object.assign(app, { nodeListener, $fetch });
}

export const listener = async () => toNodeListener(await makeTestApp());

export async function closeDb() { await pool.end(); }
