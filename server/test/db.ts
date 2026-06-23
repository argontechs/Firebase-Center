process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
import { sql } from 'drizzle-orm';
import { toNodeListener, createApp, createRouter, eventHandler } from 'h3';
import { db, pool } from '~~/server/db/client';

export { db };

const ALL_TABLES = [
  'deliveries', 'campaigns', 'jobs', 'imports', 'devices',
  'audiences', 'app_ingest_keys', 'app_credentials', 'apps', 'site_send_keys', 'companies',
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
    // M4.5: ingest-key management routes
    { default: ingestKeysPost },
    { default: ingestKeysGet },
    { default: ingestKeyRotatePost },
    { default: ingestKeyRevokePost },
    // M4.6: device registration ingest
    { default: devicesPost },
    // M4.7: operator audience listing
    { default: devicesGet },
    // M6.6: campaign preview + create
    { default: campaignPreviewPost },
    { default: campaignPost },
    // M6.7: campaign read routes
    { default: campaignsGet },
    { default: campaignGet },
    // SA.2: send-key management routes
    { default: sendKeysPost },
    { default: sendKeysGet },
    { default: sendKeyRevokePost },
    { default: sendKeyRotatePost },
    // SA.3: programmatic send API
    { default: v1MessagesPost },
    // C1: audiences CRUD
    { default: audiencesGet },
    { default: audiencesPost },
    { default: audiencePatch },
    { default: audienceDelete },
    // D1: operator device list
    { default: devicesListGet },
    // D2: manual add + tag edit + delete
    { default: deviceManualPost },
    { default: devicePatch },
    { default: deviceDelete },
    // E2: broadcast
    { default: campaignBroadcastPost },
    // E3: cancel scheduled campaign
    { default: campaignCancelPost },
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
    // M4.5
    import('~~/server/api/apps/[id]/ingest-keys/index.post'),
    import('~~/server/api/apps/[id]/ingest-keys/index.get'),
    import('~~/server/api/apps/[id]/ingest-keys/[kid]/rotate.post'),
    import('~~/server/api/apps/[id]/ingest-keys/[kid]/revoke.post'),
    // M4.6
    import('~~/server/api/apps/[id]/devices.post'),
    // M4.7
    import('~~/server/api/apps/[id]/devices.get'),
    // M6.6
    import('~~/server/api/campaigns/preview.post'),
    import('~~/server/api/campaigns/index.post'),
    // M6.7
    import('~~/server/api/campaigns/index.get'),
    import('~~/server/api/campaigns/[id].get'),
    // SA.2: send-key management
    import('~~/server/api/companies/[id]/send-keys/index.post'),
    import('~~/server/api/companies/[id]/send-keys/index.get'),
    import('~~/server/api/companies/[id]/send-keys/[kid]/revoke.post'),
    import('~~/server/api/companies/[id]/send-keys/[kid]/rotate.post'),
    // SA.3: programmatic send API
    import('~~/server/api/v1/messages.post'),
    // C1: audiences CRUD
    import('~~/server/api/apps/[id]/audiences/index.get'),
    import('~~/server/api/apps/[id]/audiences/index.post'),
    import('~~/server/api/apps/[id]/audiences/[aid]/index.patch'),
    import('~~/server/api/apps/[id]/audiences/[aid]/index.delete'),
    // D1: operator device list
    import('~~/server/api/devices/index.get'),
    // D2: manual add + tag edit + delete
    import('~~/server/api/apps/[id]/devices/manual.post'),
    import('~~/server/api/devices/[id]/index.patch'),
    import('~~/server/api/devices/[id]/index.delete'),
    // E2: broadcast
    import('~~/server/api/campaigns/broadcast.post'),
    // E3: cancel scheduled campaign
    import('~~/server/api/campaigns/[id]/cancel.post'),
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
  // M4.5: ingest-key management
  router.post('/api/apps/:id/ingest-keys', eventHandler(ingestKeysPost));
  router.get('/api/apps/:id/ingest-keys', eventHandler(ingestKeysGet));
  router.post('/api/apps/:id/ingest-keys/:kid/rotate', eventHandler(ingestKeyRotatePost));
  router.post('/api/apps/:id/ingest-keys/:kid/revoke', eventHandler(ingestKeyRevokePost));
  // M4.6: device registration ingest
  router.post('/api/apps/:id/devices', eventHandler(devicesPost));
  // M4.7: operator audience listing
  router.get('/api/apps/:id/devices', eventHandler(devicesGet));
  // M6.6: campaign preview + create
  router.post('/api/campaigns/preview', eventHandler(campaignPreviewPost));
  router.post('/api/campaigns', eventHandler(campaignPost));
  // M6.7: campaign read
  router.get('/api/campaigns', eventHandler(campaignsGet));
  router.get('/api/campaigns/:id', eventHandler(campaignGet));
  // SA.2: send-key management
  router.post('/api/companies/:id/send-keys', eventHandler(sendKeysPost));
  router.get('/api/companies/:id/send-keys', eventHandler(sendKeysGet));
  router.post('/api/companies/:id/send-keys/:kid/revoke', eventHandler(sendKeyRevokePost));
  router.post('/api/companies/:id/send-keys/:kid/rotate', eventHandler(sendKeyRotatePost));
  // SA.3: programmatic send API
  router.post('/api/v1/messages', eventHandler(v1MessagesPost));
  // C1: audiences CRUD
  router.get('/api/apps/:id/audiences', eventHandler(audiencesGet));
  router.post('/api/apps/:id/audiences', eventHandler(audiencesPost));
  router.patch('/api/apps/:id/audiences/:aid', eventHandler(audiencePatch));
  router.delete('/api/apps/:id/audiences/:aid', eventHandler(audienceDelete));
  // D1: operator device list
  router.get('/api/devices', eventHandler(devicesListGet));
  // D2: manual add + tag edit + delete
  router.post('/api/apps/:id/devices/manual', eventHandler(deviceManualPost));
  router.patch('/api/devices/:id', eventHandler(devicePatch));
  router.delete('/api/devices/:id', eventHandler(deviceDelete));
  // E2: broadcast
  router.post('/api/campaigns/broadcast', eventHandler(campaignBroadcastPost));
  // E3: cancel scheduled campaign
  router.post('/api/campaigns/:id/cancel', eventHandler(campaignCancelPost));
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
