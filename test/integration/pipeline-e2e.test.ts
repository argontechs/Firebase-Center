// Must be first — sets NUXT_DATABASE_URL before any db/client import.
import { truncateAll, makeApp, makeDevice, makeCampaign, db } from '../helpers/db';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jobs, deliveries, devices } from '~~/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { sweepStaleJobs } from '~~/server/utils/queue/sweep';

const sendMock = vi.fn();
const resolveMock = vi.fn();
vi.mock('~~/server/utils/credentials/resolve', () => ({
  resolveCredential: (...a: unknown[]) => resolveMock(...a),
  isReady: () => true,
}));
vi.mock('~~/server/utils/push/registry', () => ({
  getAdapter: () => ({
    mintToken: vi.fn().mockResolvedValue({ token: 't', expiresAt: Date.now() + 3_600_000 }),
    render: (m: unknown) => ({ provider: 'fcm', raw: m }),
    send: (...a: unknown[]) => sendMock(...a),
  }),
}));
vi.mock('~~/server/utils/push/token-cache', () => ({
  getAccessToken: vi.fn().mockResolvedValue('access-token'), invalidateToken: vi.fn(),
}));

const { runWorkerOnce, claimNextJob } = await import('~~/server/utils/queue/worker');

const readyFcm = { ready: true as const, credential: { id: 'c', appId: 'a', provider: 'fcm', platform: 'android', secret: {}, meta: {} } };

beforeEach(async () => {
  await truncateAll();
  sendMock.mockReset();
  resolveMock.mockReset().mockResolvedValue(readyFcm);
});

it('enqueue dedupes a double-submit', async () => {
  const { app } = await makeApp();
  await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
  const camp = await makeCampaign(app.id, { targetType: 'all' });
  await enqueueCampaign(camp.id);
  await enqueueCampaign(camp.id);
  const rows = await db.select().from(jobs);
  expect(rows).toHaveLength(1);
});

it('lease + stale sweep returns a crashed running job to pending and it then completes', async () => {
  const { app } = await makeApp();
  const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T' });
  const camp = await makeCampaign(app.id, { targetType: 'all' });
  await enqueueCampaign(camp.id);

  // Simulate a worker that claimed then crashed.
  const job = await claimNextJob();
  await db.execute(sql`UPDATE jobs SET claimed_at = now() - interval '10 minutes' WHERE id = ${job!.id}`);
  const swept = await sweepStaleJobs(5 * 60 * 1000);
  expect(swept.requeued).toBe(1);

  sendMock.mockResolvedValue([{ token: 'T', deviceId: d.id, status: 'sent', responseMeta: { message_id: 'm' } }]);
  expect(await runWorkerOnce()).toBe(true);
  const [done] = await db.select().from(jobs);
  expect(done.status).toBe('done');
});

it('CREDENTIAL_NOT_READY group recorded; reachable group in same campaign still sends', async () => {
  const { app } = await makeApp();
  await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'F' });
  await makeDevice(app.id, { provider: 'huawei', platform: 'huawei', token: 'H' });
  const camp = await makeCampaign(app.id, { targetType: 'all' });
  await enqueueCampaign(camp.id); // 2 jobs: one fcm, one huawei

  resolveMock.mockImplementation(async (_app: string, provider: string) =>
    provider === 'fcm' ? readyFcm : { ready: false, reason: 'NOT_CONFIGURED' });
  sendMock.mockResolvedValue([{ token: 'F', deviceId: null, status: 'sent', responseMeta: {} }]);

  let processed = true; while (processed) processed = await runWorkerOnce();

  const notReady = await db.select().from(deliveries).where(eq(deliveries.disposition, 'CREDENTIAL_NOT_READY'));
  const sent = await db.select().from(deliveries).where(eq(deliveries.status, 'sent'));
  expect(notReady).toHaveLength(1);
  expect(sent).toHaveLength(1);
});

it('dead token auto-marked invalid end-to-end', async () => {
  const { app } = await makeApp();
  const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'DEAD' });
  const camp = await makeCampaign(app.id, { targetType: 'all' });
  await enqueueCampaign(camp.id);
  sendMock.mockResolvedValue([{ token: 'DEAD', deviceId: d.id, status: 'invalid', disposition: 'DELETE_TOKEN', errorCode: 'UNREGISTERED' }]);
  await runWorkerOnce();
  const [dev] = await db.select().from(devices).where(eq(devices.id, d.id));
  expect(dev.status).toBe('invalid');
});

it('retry ceiling dead-letters to gave_up', async () => {
  const { app } = await makeApp();
  const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T' });
  const camp = await makeCampaign(app.id, { targetType: 'all' });
  await enqueueCampaign(camp.id);
  await db.update(jobs).set({ attempts: 4, maxAttempts: 5, runAfter: new Date(0) });
  sendMock.mockResolvedValue([{ token: 'T', deviceId: d.id, status: 'failed', disposition: 'RETRY_BACKOFF', errorCode: '503' }]);
  await runWorkerOnce();
  const [job] = await db.select().from(jobs);
  const [del] = await db.select().from(deliveries);
  expect(job.status).toBe('failed');
  expect(del.status).toBe('gave_up');
});
