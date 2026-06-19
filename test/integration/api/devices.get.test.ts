process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setupApiTest, closeDb } from '../../helpers/api';
import { upsertDevices } from '~~/server/utils/import/upsert';
import { companies, apps } from '~~/server/db/schema';

let ctx: Awaited<ReturnType<typeof setupApiTest>>;
let appId: string;

beforeEach(async () => {
  ctx = await setupApiTest();
  const [c] = await ctx.db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await ctx.db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
  await upsertDevices(ctx.db, appId, [
    { rowNumber: 1, token: 'fa1', provider: 'fcm', platform: 'android', externalUserId: null, attributes: {} },
    { rowNumber: 2, token: 'fi1', provider: 'fcm', platform: 'ios', externalUserId: null, attributes: {} },
    { rowNumber: 3, token: 'hw1', provider: 'huawei', platform: 'huawei', externalUserId: null, attributes: {} },
  ]);
});

afterAll(async () => { await closeDb(); });

it('lists devices with total for an operator session', async () => {
  const res = await ctx.$fetch(`/api/apps/${appId}/devices`) as any;
  expect(res.total).toBe(3);
  expect(res.devices).toHaveLength(3);
});

it('pages with limit/offset while total reflects the full set', async () => {
  const res = await ctx.$fetch(`/api/apps/${appId}/devices?limit=2&offset=0`) as any;
  expect(res.devices).toHaveLength(2);
  expect(res.total).toBe(3);
});

it('filters by provider and platform', async () => {
  const res = await ctx.$fetch(`/api/apps/${appId}/devices?provider=fcm&platform=ios`) as any;
  expect(res.total).toBe(1);
  expect(res.devices[0].token).toBe('fi1');
});

it('rejects an unauthenticated request with 401', async () => {
  await expect(ctx.anonFetch(`/api/apps/${appId}/devices`)).rejects.toMatchObject({ statusCode: 401 });
});
