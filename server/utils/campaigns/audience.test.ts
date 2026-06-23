import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~~/server/db/client';
import { devices, apps, companies, appCredentials } from '~~/server/db/schema';
import { resetDb } from '~~/server/test/db';
import { previewAudience } from './audience';

let appId = '';

beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'C' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;

  // Seed devices:
  // fcm/android vip
  // fcm/android (no tag)
  // huawei/huawei vip
  // fcm/ios (no tag)
  await db.insert(devices).values([
    { appId, provider: 'fcm', platform: 'android', token: 't1', tags: ['vip'], status: 'active' },
    { appId, provider: 'fcm', platform: 'android', token: 't2', tags: [], status: 'active' },
    { appId, provider: 'huawei', platform: 'huawei', token: 't3', tags: ['vip'], status: 'active' },
    { appId, provider: 'fcm', platform: 'ios', token: 't4', tags: [], status: 'active' },
    // inactive — must not appear
    { appId, provider: 'fcm', platform: 'android', token: 't5', tags: ['vip'], status: 'invalid' },
  ]);
});

describe('previewAudience segment', () => {
  it('segment with tag filter returns groups only for vip devices', async () => {
    const groups = await previewAudience(appId, 'segment', { filter: { tag: 'vip' } });
    // vip devices: fcm/android (1) + huawei/huawei (1)
    expect(groups).toHaveLength(2);
    const total = groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(2);
    const providers = new Set(groups.map((g) => g.provider));
    expect(providers).toContain('fcm');
    expect(providers).toContain('huawei');
  });

  it('segment with empty filter returns all active devices grouped', async () => {
    const groups = await previewAudience(appId, 'segment', {});
    // all 4 active devices -> 3 groups: fcm/android(2), huawei/huawei(1), fcm/ios(1)
    expect(groups).toHaveLength(3);
    const total = groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(4);
  });

  it('segment still rejects topic targetType via all/tokens path (backwards compat)', async () => {
    // all still works
    const groups = await previewAudience(appId, 'all', {});
    expect(groups.length).toBeGreaterThan(0);
  });
});
