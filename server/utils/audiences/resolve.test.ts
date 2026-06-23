import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~~/server/db/client';
import { devices, apps, companies } from '~~/server/db/schema';
import { resetDb } from '~~/server/test/db';
import { countAudience, resolveAudienceDevices } from './resolve';

let appId = '';
let otherAppId = '';

beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'C' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  const [b] = await db.insert(apps).values({ companyId: c.id, name: 'B' }).returning();
  appId = a.id;
  otherAppId = b.id;

  // 4 active devices for appId:
  // 1: fcm/android, tags: ['vip']
  // 2: fcm/ios, no tags
  // 3: huawei/huawei, tags: ['vip']
  // 4: fcm/android, no tags
  // 1 invalid device for appId
  // 1 active device for otherAppId
  await db.insert(devices).values([
    { appId, provider: 'fcm', platform: 'android', token: 't1', tags: ['vip'], status: 'active' },
    { appId, provider: 'fcm', platform: 'ios', token: 't2', tags: [], status: 'active' },
    { appId, provider: 'huawei', platform: 'huawei', token: 't3', tags: ['vip'], status: 'active' },
    { appId, provider: 'fcm', platform: 'android', token: 't4', tags: [], status: 'active' },
    { appId, provider: 'fcm', platform: 'android', token: 't5', tags: [], status: 'invalid' },
    { appId: otherAppId, provider: 'fcm', platform: 'android', token: 't6', tags: [], status: 'active' },
  ]);
});

describe('countAudience', () => {
  it('counts all active devices for this app when filter is empty', async () => {
    expect(await countAudience(appId, {})).toBe(4);
  });

  it('filters by platform', async () => {
    expect(await countAudience(appId, { platform: 'android' })).toBe(2);
  });

  it('filters by provider', async () => {
    expect(await countAudience(appId, { provider: 'huawei' })).toBe(1);
  });

  it('filters by tag', async () => {
    expect(await countAudience(appId, { tag: 'vip' })).toBe(2);
  });

  it('filters by platform and tag combined', async () => {
    expect(await countAudience(appId, { platform: 'android', tag: 'vip' })).toBe(1);
  });
});

describe('resolveAudienceDevices', () => {
  it('returns only active devices matching the filter', async () => {
    const rows = await resolveAudienceDevices(appId, { tag: 'vip' });
    expect(rows).toHaveLength(2);
    expect(rows.every((d) => d.tags.includes('vip'))).toBe(true);
    expect(rows.every((d) => d.status === 'active')).toBe(true);
  });

  it('does not include devices from other apps', async () => {
    const rows = await resolveAudienceDevices(appId, {});
    expect(rows.every((d) => d.appId === appId)).toBe(true);
    expect(rows).toHaveLength(4);
  });
});
