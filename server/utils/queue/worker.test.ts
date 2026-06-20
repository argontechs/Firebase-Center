/**
 * F6: Worker campaign-status transitions.
 *
 * These tests use the real test Postgres (truncated between tests) and mock
 * only the external push adapters.  They verify:
 *
 *   1. Claiming a job advances campaign status queued → sending.
 *   2. When all jobs finish successfully (done), campaign becomes "done".
 *   3. When any delivery has gave_up/failed, campaign becomes "failed".
 *   4. A campaign with two jobs only finalises once BOTH jobs are terminal.
 *
 * The tests would FAIL on the old code (no campaign status updates) and PASS
 * on the fixed code.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ── mocks must be hoisted before any real imports ──────────────────────────

const mockSend = vi.fn();
const mockMintToken = vi.fn();
const mockRender = vi.fn();

vi.mock('~~/server/utils/credentials/resolve', () => ({
  resolveCredential: vi.fn(),
}));
vi.mock('~~/server/utils/push/registry', () => ({
  getAdapter: vi.fn(),
}));
vi.mock('~~/server/utils/push/token-cache', () => ({
  getAccessToken: vi.fn(),
  invalidateToken: vi.fn(),
}));

// ── real imports (after mocks) ─────────────────────────────────────────────

import { db, resetDb, closeDb } from '~~/server/test/db';
import {
  users, companies, apps, devices, campaigns, jobs, deliveries,
} from '~~/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { runWorkerOnce } from './worker';
import { resolveCredential } from '~~/server/utils/credentials/resolve';
import { getAdapter } from '~~/server/utils/push/registry';
import { getAccessToken } from '~~/server/utils/push/token-cache';
import type { ResolvedCredential } from '~~/server/utils/push/types';

// ── type cast helpers ──────────────────────────────────────────────────────

const mockResolve = resolveCredential as ReturnType<typeof vi.fn>;
const mockGetAdapter = getAdapter as ReturnType<typeof vi.fn>;
const mockGetToken = getAccessToken as ReturnType<typeof vi.fn>;

// ── test DB fixture helpers ────────────────────────────────────────────────

let _appId: string;
let _userId: string;

async function seedBase() {
  const [u] = await db.insert(users).values({
    email: 'worker-test@example.com',
    passwordHash: 'x',
    role: 'admin',
  }).returning({ id: users.id });
  _userId = u.id;

  const [co] = await db.insert(companies).values({ name: 'WorkerCo' }).returning({ id: companies.id });
  const [ap] = await db.insert(apps).values({ companyId: co.id, name: 'WorkerApp' }).returning({ id: apps.id });
  _appId = ap.id;
}

async function insertDevice(token = 'tok-1') {
  const [d] = await db.insert(devices).values({
    appId: _appId,
    provider: 'fcm',
    platform: 'android',
    token,
    status: 'active',
  }).returning({ id: devices.id });
  return d.id;
}

async function insertCampaign(status: 'queued' | 'sending' = 'queued') {
  const [c] = await db.insert(campaigns).values({
    appId: _appId,
    title: 'Test',
    body: 'Body',
    mode: 'notification',
    priority: 'high',
    targetType: 'all',
    providerScope: 'both',
    status,
    createdBy: _userId,
  }).returning({ id: campaigns.id });
  return c.id;
}

async function insertJob(campaignId: string, deviceId: string) {
  const [j] = await db.insert(jobs).values({
    type: 'send_chunk',
    payloadJsonb: {
      campaignId,
      provider: 'fcm',
      platform: 'android',
      deviceIds: [deviceId],
      chunkIndex: 0,
    },
    idempotencyKey: `${campaignId}:0`,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    campaignId,
  }).returning({ id: jobs.id });
  return j.id;
}

async function getCampaignStatus(id: string) {
  const [c] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, id));
  return c?.status;
}

// ── mock setup ─────────────────────────────────────────────────────────────

const fakeCred: ResolvedCredential = {
  id: 'cred-1',
  appId: 'app-1',
  provider: 'fcm',
  platform: 'android',
  secret: { project_id: 'p1', client_email: 'x@p1.iam', private_key: '---KEY---' },
  meta: {},
};

function setupMocksForSuccess() {
  mockResolve.mockResolvedValue({ ready: true, credential: fakeCred });
  mockGetToken.mockResolvedValue({ token: 'at-1', expiresAt: Date.now() + 3600_000 });
  mockRender.mockReturnValue({ raw: {} });
  // Returns a single successful delivery per token.
  mockSend.mockImplementation(async (_cred: unknown, _wire: unknown, recipients: Array<{ deviceId: string; token: string }>) =>
    recipients.map((r) => ({ deviceId: r.deviceId, token: r.token, status: 'sent', disposition: null })),
  );
  mockGetAdapter.mockReturnValue({ mintToken: mockMintToken, render: mockRender, send: mockSend });
}

function setupMocksForFailure() {
  mockResolve.mockResolvedValue({ ready: true, credential: fakeCred });
  mockGetToken.mockResolvedValue({ token: 'at-1', expiresAt: Date.now() + 3600_000 });
  mockRender.mockReturnValue({ raw: {} });
  // All tokens hit a terminal non-transient error → job → failed.
  mockSend.mockImplementation(async (_cred: unknown, _wire: unknown, recipients: Array<{ deviceId: string; token: string }>) =>
    recipients.map((r) => ({ deviceId: r.deviceId, token: r.token, status: 'failed', disposition: 'FIX_CREDENTIALS' })),
  );
  mockGetAdapter.mockReturnValue({ mintToken: mockMintToken, render: mockRender, send: mockSend });
}

// ── lifecycle ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  await seedBase();
});

afterAll(async () => {
  await closeDb();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('F6: campaign status driven by worker', () => {
  it('advances campaign queued → sending when the first job is claimed', async () => {
    const deviceId = await insertDevice('tok-s1');
    const campaignId = await insertCampaign('queued');
    await insertJob(campaignId, deviceId);

    setupMocksForSuccess();

    // The test asserts on the in-flight state — we need to observe after claim
    // but before job completes.  runWorkerOnce() advances to sending BEFORE
    // processing, so after a successful run the campaign will be "done"; we
    // verify "done" which proves it went through "sending" too.
    // To isolate the queued→sending step, spy on it with a one-time mock that
    // records the campaign status right after the advancing update.
    let statusDuringProcessing: string | undefined;
    const originalSend = mockSend.getMockImplementation()!;
    mockSend.mockImplementationOnce(async (...args: Parameters<typeof originalSend>) => {
      statusDuringProcessing = await getCampaignStatus(campaignId);
      return originalSend(...args);
    });

    await runWorkerOnce();

    // During processing, the campaign must have been "sending".
    expect(statusDuringProcessing).toBe('sending');
  });

  it('sets campaign status to done when all jobs succeed', async () => {
    const deviceId = await insertDevice('tok-d1');
    const campaignId = await insertCampaign('queued');
    await insertJob(campaignId, deviceId);

    setupMocksForSuccess();
    await runWorkerOnce();

    // OLD CODE: campaign stays 'queued'. FIXED CODE: campaign is 'done'.
    const status = await getCampaignStatus(campaignId);
    expect(status).toBe('done');
  });

  it('sets campaign status to failed when a job delivers gave_up rows', async () => {
    const deviceId = await insertDevice('tok-f1');
    const campaignId = await insertCampaign('queued');
    await insertJob(campaignId, deviceId);

    setupMocksForFailure();
    await runWorkerOnce();

    // OLD CODE: campaign stays 'queued'. FIXED CODE: campaign is 'failed'.
    const status = await getCampaignStatus(campaignId);
    expect(status).toBe('failed');
  });

  it('waits for all jobs to finish before finalising campaign status', async () => {
    // Two devices → two jobs (inserted manually with different chunkIndex).
    const deviceId1 = await insertDevice('tok-m1');
    const deviceId2 = await insertDevice('tok-m2');
    const campaignId = await insertCampaign('queued');

    // Insert two distinct jobs for the same campaign.
    const [j1] = await db.insert(jobs).values({
      type: 'send_chunk',
      payloadJsonb: {
        campaignId, provider: 'fcm', platform: 'android', deviceIds: [deviceId1], chunkIndex: 0,
      },
      idempotencyKey: `${campaignId}:0`,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      campaignId,
    }).returning({ id: jobs.id });

    const [j2] = await db.insert(jobs).values({
      type: 'send_chunk',
      payloadJsonb: {
        campaignId, provider: 'fcm', platform: 'android', deviceIds: [deviceId2], chunkIndex: 1,
      },
      idempotencyKey: `${campaignId}:1`,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      campaignId,
    }).returning({ id: jobs.id });

    setupMocksForSuccess();

    // Run first job.
    await runWorkerOnce();

    // After one of two jobs finishes, campaign must NOT be 'done' yet.
    const midStatus = await getCampaignStatus(campaignId);
    expect(midStatus).toBe('sending'); // still in flight

    // Run second job.
    await runWorkerOnce();

    // Now both jobs are done → campaign must be 'done'.
    const finalStatus = await getCampaignStatus(campaignId);
    expect(finalStatus).toBe('done');

    // Suppress unused variable warning.
    void j1; void j2;
  });
});
