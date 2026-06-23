import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~~/server/db/client';
import { devices, audiences, campaigns, apps, companies } from '~~/server/db/schema';
import { resetDb } from '~~/server/test/db';
import { eq } from 'drizzle-orm';

let appId = '';
beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'C' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
});

it('devices carry a tags array defaulting to empty', async () => {
  const [d] = await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 't1' }).returning();
  expect(d.tags).toEqual([]);
  const [d2] = await db.insert(devices).values({ appId, provider: 'fcm', platform: 'android', token: 't2', tags: ['vip','kl'] }).returning();
  expect(d2.tags).toEqual(['vip','kl']);
});

it('audiences store a per-app named filter', async () => {
  const [au] = await db.insert(audiences).values({ appId, name: 'VIP Android', platform: 'android', tag: 'vip' }).returning();
  expect(au.name).toBe('VIP Android');
  expect(au.platform).toBe('android');
});

it('campaigns accept scheduled status + scheduled_at + broadcast_id', async () => {
  const when = new Date('2030-01-01T00:00:00Z');
  const [camp] = await db.insert(campaigns).values({
    appId, title: 'T', body: 'B', targetType: 'segment',
    targetValueJsonb: { filter: { tag: 'vip' } }, status: 'scheduled', scheduledAt: when, broadcastId: '00000000-0000-0000-0000-000000000001',
  }).returning();
  expect(camp.status).toBe('scheduled');
  expect(camp.scheduledAt?.toISOString()).toBe(when.toISOString());
});
