/**
 * F1: Due-campaign sweep.
 *
 * Tests that sweepDueCampaigns() promotes scheduled campaigns whose
 * scheduled_at is in the past, creates jobs for them, and is idempotent.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDb, closeDb } from '~~/server/test/db';
import { companies, apps, devices, campaigns, jobs } from '~~/server/db/schema';
import { eq, count } from 'drizzle-orm';
import { sweepDueCampaigns } from './due';

let appId: string;

beforeEach(async () => {
  await resetDb();
  const [co] = await db.insert(companies).values({ name: 'SweepCo' }).returning({ id: companies.id });
  const [ap] = await db.insert(apps).values({ companyId: co.id, name: 'SweepApp' }).returning({ id: apps.id });
  appId = ap.id;
  // Seed one active device so enqueueCampaign creates at least one job.
  await db.insert(devices).values({
    appId,
    provider: 'fcm',
    platform: 'android',
    token: 'tok-sweep',
    status: 'active',
  });
});

afterAll(async () => {
  await closeDb();
});

describe('F1: sweepDueCampaigns', () => {
  it('enqueues and transitions a past-due scheduled campaign, returns 1', async () => {
    const past = new Date(Date.now() - 60_000); // 1 minute ago
    const [camp] = await db.insert(campaigns).values({
      appId,
      title: 'Due now',
      body: 'Body',
      targetType: 'all',
      status: 'scheduled',
      scheduledAt: past,
    }).returning({ id: campaigns.id });

    const n = await sweepDueCampaigns();
    expect(n).toBe(1);

    // Campaign status must be 'sending' (enqueueCampaign flips queued→sending in worker,
    // but sweep sets it to 'sending' directly after enqueue).
    const [updated] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, camp.id));
    expect(updated.status).toBe('sending');

    // At least one job must have been created.
    const [{ value: jobCount }] = await db.select({ value: count() })
      .from(jobs).where(eq(jobs.campaignId, camp.id));
    expect(jobCount).toBeGreaterThan(0);
  });

  it('does not enqueue a campaign scheduled in the future, returns 0', async () => {
    const future = new Date(Date.now() + 60_000); // 1 minute from now
    await db.insert(campaigns).values({
      appId,
      title: 'Not yet',
      body: 'Body',
      targetType: 'all',
      status: 'scheduled',
      scheduledAt: future,
    });

    const n = await sweepDueCampaigns();
    expect(n).toBe(0);
  });

  it('is idempotent — a second call returns 0 (campaign already sending)', async () => {
    const past = new Date(Date.now() - 60_000);
    await db.insert(campaigns).values({
      appId,
      title: 'Idempotent',
      body: 'Body',
      targetType: 'all',
      status: 'scheduled',
      scheduledAt: past,
    });

    const first = await sweepDueCampaigns();
    expect(first).toBe(1);

    const second = await sweepDueCampaigns();
    expect(second).toBe(0);
  });

  it('handles a mix of past and future scheduled campaigns correctly', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    await db.insert(campaigns).values([
      { appId, title: 'Past', body: 'B', targetType: 'all', status: 'scheduled', scheduledAt: past },
      { appId, title: 'Future', body: 'B', targetType: 'all', status: 'scheduled', scheduledAt: future },
    ]);

    const n = await sweepDueCampaigns();
    expect(n).toBe(1);
  });
});
