// Must be first — sets NUXT_DATABASE_URL before any db/client import.
import { db, truncateAll } from '../helpers/db';
import { describe, it, expect, beforeEach } from 'vitest';
import { jobs } from '~~/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { sweepStaleJobs } from '~~/server/utils/queue/sweep';
import { JOB_TYPE_SEND } from '~~/server/utils/queue/types';

beforeEach(async () => { await truncateAll(); });

it('requeues a running job whose lease expired', async () => {
  const [j] = await db.insert(jobs).values({
    type: JOB_TYPE_SEND, payloadJsonb: {}, idempotencyKey: 'stale:0', status: 'running',
  }).returning();
  // backdate claimed_at by 10 minutes
  await db.execute(sql`UPDATE jobs SET claimed_at = now() - interval '10 minutes' WHERE id = ${j.id}`);

  const res = await sweepStaleJobs(5 * 60 * 1000);
  expect(res.requeued).toBe(1);
  const [after] = await db.select().from(jobs).where(eq(jobs.id, j.id));
  expect(after.status).toBe('pending');
  expect(after.claimedAt).toBeNull();
});

it('leaves a freshly-claimed running job alone', async () => {
  await db.insert(jobs).values({
    type: JOB_TYPE_SEND, payloadJsonb: {}, idempotencyKey: 'fresh:0', status: 'running', claimedAt: new Date(),
  });
  const res = await sweepStaleJobs(5 * 60 * 1000);
  expect(res.requeued).toBe(0);
});

it('ignores done/failed jobs', async () => {
  await db.insert(jobs).values({
    type: JOB_TYPE_SEND, payloadJsonb: {}, idempotencyKey: 'done:0', status: 'done',
  });
  const res = await sweepStaleJobs(0);
  expect(res.requeued).toBe(0);
});
