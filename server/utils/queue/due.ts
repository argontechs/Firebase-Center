import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { enqueueCampaign } from './enqueue';

export async function sweepDueCampaigns(now = new Date()): Promise<number> {
  const due = await db.execute(sql`
    SELECT id FROM campaigns
    WHERE status = 'scheduled' AND scheduled_at <= ${now}
    ORDER BY scheduled_at ASC FOR UPDATE SKIP LOCKED LIMIT 50`);
  const rows = (due.rows ?? due) as { id: string }[];
  let n = 0;
  for (const { id } of rows) {
    await enqueueCampaign(id);
    await db.update(campaigns).set({ status: 'sending' }).where(and(eq(campaigns.id, id), eq(campaigns.status, 'scheduled')));
    n++;
  }
  return n;
}
