// Must be first — sets NUXT_DATABASE_URL before any db/client import.
import { truncateAll, makeApp, makeDevice, makeCampaign, db } from '../helpers/db';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jobs, deliveries } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';

// Mock the credential resolver and provider registry so no real provider HTTP happens.
const sendMock = vi.fn();
vi.mock('~~/server/utils/credentials/resolve', () => ({
  resolveCredential: vi.fn().mockResolvedValue({
    ready: true,
    credential: { id: 'c', appId: 'a', provider: 'fcm', platform: 'android', secret: {}, meta: {} },
  }),
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
  getAccessToken: vi.fn().mockResolvedValue('access-token'),
  invalidateToken: vi.fn(),
}));
vi.mock('~~/server/utils/payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~~/server/utils/payload')>();
  return { ...actual, validatePayloadSize: vi.fn() };
});

const { runWorkerOnce } = await import('~~/server/utils/queue/worker');

beforeEach(async () => {
  await truncateAll();
  sendMock.mockReset();
});

describe('worker retry / dead-letter logic', () => {
  it('RETRY_BACKOFF requeues the job (pending, attempts incremented, run_after in future)', async () => {
    const { app } = await makeApp();
    const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValue([
      { token: 'T', deviceId: d.id, status: 'failed', disposition: 'RETRY_BACKOFF', errorCode: '503' },
    ]);

    await runWorkerOnce();
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(new Date(job.runAfter).getTime()).toBeGreaterThan(Date.now());
    // no permanent delivery rows written yet for retryable tokens
    const dels = await db.select().from(deliveries);
    expect(dels).toHaveLength(0);
  });

  it('non-transient disposition (FIX_CREDENTIALS) fails the job terminally with last_error, no retry', async () => {
    const { app } = await makeApp();
    const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValue([
      { token: 'T', deviceId: d.id, status: 'failed', disposition: 'FIX_CREDENTIALS', errorCode: 'THIRD_PARTY_AUTH_ERROR' },
    ]);

    await runWorkerOnce();
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('FIX_CREDENTIALS');
    const [del] = await db.select().from(deliveries);
    expect(del.status).toBe('failed');
    expect(del.disposition).toBe('FIX_CREDENTIALS');
  });

  it('retry exhaustion -> job failed and deliveries gave_up', async () => {
    const { app } = await makeApp();
    const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    // Force the job to its last attempt so this RETRY_BACKOFF exhausts the ceiling.
    await db.update(jobs).set({ attempts: 4, maxAttempts: 5, runAfter: new Date(0) });
    sendMock.mockResolvedValue([
      { token: 'T', deviceId: d.id, status: 'failed', disposition: 'RETRY_BACKOFF', errorCode: '503' },
    ]);

    await runWorkerOnce();
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(5);
    const [del] = await db.select().from(deliveries);
    expect(del.status).toBe('gave_up');
  });

  it('mixed sent + RETRY_BACKOFF: sent rows persisted, only failed tokens retried on next pass', async () => {
    const { app } = await makeApp();
    const dOk = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'OK' });
    const dRetry = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'RETRY' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValueOnce([
      { token: 'OK', deviceId: dOk.id, status: 'sent', responseMeta: { message_id: 'm' } },
      { token: 'RETRY', deviceId: dRetry.id, status: 'failed', disposition: 'RETRY_BACKOFF', errorCode: '503' },
    ]);
    await runWorkerOnce();

    // sent persisted immediately
    const sent = await db.select().from(deliveries).where(eq(deliveries.token, 'OK'));
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe('sent');
    // job requeued, only RETRY token remains for next attempt
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('pending');
    expect((job.payloadJsonb as { deviceIds: string[] }).deviceIds).toEqual([dRetry.id]);
  });
});
