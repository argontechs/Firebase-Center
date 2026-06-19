// Must be first — sets NUXT_DATABASE_URL before any db/client import.
import { truncateAll, makeApp, makeDevice, makeCampaign, db } from '../helpers/db';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jobs, deliveries, devices } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';

// Mock the credential resolver and provider registry so no real provider HTTP happens.
const resolveCredentialMock = vi.fn();
const sendMock = vi.fn();
const renderMock = vi.fn((m: unknown) => ({ provider: 'fcm', raw: m }));
vi.mock('~~/server/utils/credentials/resolve', () => ({
  resolveCredential: (...a: unknown[]) => resolveCredentialMock(...a),
  isReady: () => true,
}));
vi.mock('~~/server/utils/push/registry', () => ({
  getAdapter: () => ({
    mintToken: vi.fn().mockResolvedValue({ token: 't', expiresAt: Date.now() + 3_600_000 }),
    render: (m: unknown) => renderMock(m),
    send: (...a: unknown[]) => sendMock(...a),
  }),
}));
const getAccessTokenMock = vi.fn().mockResolvedValue('access-token');
vi.mock('~~/server/utils/push/token-cache', () => ({
  getAccessToken: (...a: unknown[]) => getAccessTokenMock(...a),
  invalidateToken: vi.fn(),
}));
vi.mock('~~/server/utils/payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~~/server/utils/payload')>();
  return { ...actual, validatePayloadSize: vi.fn() };
});
const { validatePayloadSize } = await import('~~/server/utils/payload');

const { claimNextJob, runWorkerOnce } = await import('~~/server/utils/queue/worker');

const readyCred = {
  ready: true as const,
  credential: { id: 'cred1', appId: 'app', provider: 'fcm', platform: 'android', secret: {}, meta: {} },
};

beforeEach(async () => {
  await truncateAll();
  resolveCredentialMock.mockReset().mockResolvedValue(readyCred);
  sendMock.mockReset();
  renderMock.mockReset().mockImplementation((m: unknown) => ({ provider: 'fcm', raw: m }));
  getAccessTokenMock.mockReset().mockResolvedValue('access-token');
  vi.mocked(validatePayloadSize).mockReset();
});

describe('claimNextJob', () => {
  it('claims one pending job, marks running + claimed_at, returns it', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    const job = await claimNextJob();
    expect(job).not.toBeNull();
    expect(job!.status).toBe('running');
    expect(job!.claimedAt).not.toBeNull();
  });

  it('returns null when no pending jobs', async () => {
    expect(await claimNextJob()).toBeNull();
  });
});

describe('runWorkerOnce — happy path', () => {
  it('sends a ready group and writes sent deliveries', async () => {
    const { app } = await makeApp();
    const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'TOK1' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValue([
      { token: 'TOK1', deviceId: d.id, status: 'sent', responseMeta: { message_id: 'm1' } },
    ]);

    const processed = await runWorkerOnce();
    expect(processed).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const dels = await db.select().from(deliveries).where(eq(deliveries.campaignId, camp.id));
    expect(dels).toHaveLength(1);
    expect(dels[0].status).toBe('sent');
    expect(dels[0].token).toBe('TOK1');

    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('done');
  });

  it('marks DELETE_TOKEN devices invalid', async () => {
    const { app } = await makeApp();
    const d = await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'DEAD' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValue([
      { token: 'DEAD', deviceId: d.id, status: 'invalid', disposition: 'DELETE_TOKEN', errorCode: 'UNREGISTERED' },
    ]);

    await runWorkerOnce();

    const [dev] = await db.select().from(devices).where(eq(devices.id, d.id));
    expect(dev.status).toBe('invalid');
    const [del] = await db.select().from(deliveries);
    expect(del.status).toBe('invalid');
    expect(del.disposition).toBe('DELETE_TOKEN');
  });

  it('records CREDENTIAL_NOT_READY when the group has no ready credential', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'X' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    resolveCredentialMock.mockResolvedValue({ ready: false, reason: 'NOT_CONFIGURED' });

    const processed = await runWorkerOnce();
    expect(processed).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();

    const [del] = await db.select().from(deliveries);
    expect(del.status).toBe('failed');
    expect(del.disposition).toBe('CREDENTIAL_NOT_READY');
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('done');
  });

  it('returns false when there is nothing to process', async () => {
    expect(await runWorkerOnce()).toBe(false);
  });

  it('calls validatePayloadSize before render — PayloadTooLargeError marks job failed without calling send', async () => {
    const { PayloadTooLargeError } = await import('~~/server/utils/payload');
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T1' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    vi.mocked(validatePayloadSize).mockImplementation(() => {
      throw new PayloadTooLargeError(5000, 'fcm');
    });

    await runWorkerOnce();

    expect(sendMock).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('failed');
    expect(job.lastError).toMatch(/PayloadTooLargeError|5000/);
  });

  it('writeResults with empty results array does not throw (Drizzle empty-values guard)', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T2' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    // adapter.send returns empty array — writeResults must silently skip the insert
    sendMock.mockResolvedValue([]);

    const processed = await runWorkerOnce();
    expect(processed).toBe(true);

    const dels = await db.select().from(deliveries);
    expect(dels).toHaveLength(0);
    const [job] = await db.select().from(jobs);
    expect(job.status).toBe('done');
  });

  it('getAccessToken is called before render so Huawei token cache is warm', async () => {
    const { app } = await makeApp();
    await makeDevice(app.id, { provider: 'fcm', platform: 'android', token: 'T3' });
    const camp = await makeCampaign(app.id, { targetType: 'all' });
    await enqueueCampaign(camp.id);

    sendMock.mockResolvedValue([
      { token: 'T3', deviceId: null, status: 'sent', responseMeta: {} },
    ]);

    await runWorkerOnce();

    // getAccessToken must be called before render (cache warm-up before adapter.render)
    expect(getAccessTokenMock).toHaveBeenCalled();
    const getAccessTokenCallOrder = getAccessTokenMock.mock.invocationCallOrder[0];
    const renderCallOrder = renderMock.mock.invocationCallOrder[0];
    expect(getAccessTokenCallOrder).toBeLessThan(renderCallOrder);
  });
});
