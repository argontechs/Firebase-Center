import { defineEventHandler, getRouterParam, createError } from 'h3';
import { eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { campaigns, deliveries } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

/**
 * GET /api/campaigns/:id
 *
 * Returns the full campaign row plus all delivery rows for it, ordered by
 * sentAt DESC NULLS LAST.
 *
 * Requires operator session; GET route — no CSRF check.
 */
export default defineEventHandler(async (event) => {
  await requireSession(event);

  const id = getRouterParam(event, 'id') ?? '';
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) throw createError({ statusCode: 404, statusMessage: 'campaign not found' });

  const dels = await db.select().from(deliveries)
    .where(eq(deliveries.campaignId, id))
    .orderBy(sql`${deliveries.sentAt} DESC NULLS LAST`);

  return { campaign, deliveries: dels };
});
