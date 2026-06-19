import { db } from '~~/server/db/client';
import { jobs } from '~~/server/db/schema';
import { and, eq, lt } from 'drizzle-orm';

export async function sweepStaleJobs(visibilityTimeoutMs: number): Promise<{ requeued: number }> {
  const cutoff = new Date(Date.now() - visibilityTimeoutMs);
  const requeued = await db.update(jobs)
    .set({ status: 'pending', claimedAt: null })
    .where(and(eq(jobs.status, 'running'), lt(jobs.claimedAt, cutoff)))
    .returning({ id: jobs.id });
  return { requeued: requeued.length };
}
