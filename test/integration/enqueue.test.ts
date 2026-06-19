import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../helpers/db';
import { jobs } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { truncateAll, makeApp, makeDevice, makeCampaign } from '../helpers/db';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { JOB_TYPE_SEND } from '~~/server/utils/queue/types';
import { pool } from '~~/server/db/client';

describe('enqueueCampaign', () => {
  beforeEach(async () => { await truncateAll(); });

  afterAll(async () => { await pool.end(); });

  it('creates one job for a small all-devices campaign', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });

    const res = await enqueueCampaign(camp.id);
    expect(res.jobsCreated).toBe(1);

    const rows = await db.select().from(jobs).where(eq(jobs.type, JOB_TYPE_SEND));
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotencyKey).toBe(`${camp.id}:0`);
    expect(rows[0].status).toBe('pending');
  });

  it('chunks fcm to 500-device chunks', async () => {
    const { app } = await makeApp();
    for (let i = 0; i < 501; i++) await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });

    const res = await enqueueCampaign(camp.id);
    expect(res.jobsCreated).toBe(2);
  });

  it('chunks huawei to 1000-device chunks', async () => {
    const { app } = await makeApp();
    for (let i = 0; i < 1001; i++) await makeDevice(app.id, { provider: 'huawei', platform: 'huawei' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });

    const res = await enqueueCampaign(camp.id);
    expect(res.jobsCreated).toBe(2);
  });

  it('is idempotent: double-enqueue creates no duplicate jobs', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });

    const first = await enqueueCampaign(camp.id);
    const second = await enqueueCampaign(camp.id);
    expect(first.jobsCreated).toBe(1);
    expect(second.jobsCreated).toBe(0);

    const rows = await db.select().from(jobs).where(eq(jobs.type, JOB_TYPE_SEND));
    expect(rows).toHaveLength(1);
  });

  it('chunkIndex is globally monotonic across mixed (provider,platform) groups', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    await makeDevice(app.id, { provider: 'huawei', platform: 'huawei' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });

    const res = await enqueueCampaign(camp.id);
    expect(res.jobsCreated).toBe(2);

    const rows = await db.select().from(jobs).where(eq(jobs.type, JOB_TYPE_SEND));
    expect(rows).toHaveLength(2);

    const keys = rows.map(r => r.idempotencyKey).sort();
    expect(keys).toEqual([`${camp.id}:0`, `${camp.id}:1`]);

    // Each job must carry a distinct (provider, platform) in its payload
    const payloads = rows.map(r => r.payloadJsonb as { provider: string; platform: string });
    const combos = new Set(payloads.map(p => `${p.provider}:${p.platform}`));
    expect(combos.size).toBe(2);
  });

  it('respects target_type=tokens (device_ids subset, only active devices)', async () => {
    const { app } = await makeApp();
    const d1 = await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    await makeDevice(app.id, { provider: 'fcm', platform: 'android' }); // not targeted
    const camp = await makeCampaign(app.id, {
      targetType: 'tokens',
      targetValueJsonb: { device_ids: [d1.id] },
    });
    const res = await enqueueCampaign(camp.id);
    expect(res.jobsCreated).toBe(1);

    const rows = await db.select().from(jobs).where(eq(jobs.type, JOB_TYPE_SEND));
    expect(rows).toHaveLength(1);
    const payload = rows[0].payloadJsonb as { deviceIds: string[] };
    expect(payload.deviceIds).toEqual([d1.id]);
  });
});
