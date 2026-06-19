// Sets NUXT_DATABASE_URL before importing db/client (same pattern as server/test/db.ts).
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { db } from '~~/server/db/client';
import { companies, apps, devices, campaigns, jobs, deliveries, appCredentials, appIngestKeys, auditLog, sessions, users } from '~~/server/db/schema';
import { sql } from 'drizzle-orm';

export { db };

export async function truncateAll() {
  await db.execute(
    sql`TRUNCATE TABLE deliveries, jobs, campaigns, devices, app_ingest_keys, app_credentials, apps, companies, audit_log, sessions, users RESTART IDENTITY CASCADE`,
  );
}

export async function makeApp() {
  const [c] = await db.insert(companies).values({ name: `TestCo-${Math.random().toString(36).slice(2)}` }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'TestApp' }).returning();
  return { company: c, app: a };
}

export async function makeDevice(appId: string, opts: Partial<typeof devices.$inferInsert> = {}) {
  const [d] = await db.insert(devices).values({
    appId,
    provider: opts.provider ?? 'fcm',
    platform: opts.platform ?? 'android',
    token: opts.token ?? `tok_${Math.random().toString(36).slice(2)}`,
    status: opts.status ?? 'active',
    ...opts,
  }).returning();
  return d;
}

export async function makeCampaign(appId: string, opts: Partial<typeof campaigns.$inferInsert> = {}) {
  const [c] = await db.insert(campaigns).values({
    appId,
    title: opts.title ?? 'T',
    body: opts.body ?? 'B',
    targetType: opts.targetType ?? 'all',
    ...opts,
  }).returning();
  return c;
}
