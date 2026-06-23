import { defineEventHandler, getQuery, createError } from 'h3';
import { eq, sql, desc, inArray } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { campaigns, deliveries } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

/**
 * GET /api/campaigns?appId=
 *
 * Returns a summary list of campaigns for a given app, with per-campaign
 * delivery counts (sent, failed, invalid, gave_up, not_ready).
 *
 * `not_ready` = deliveries with disposition='CREDENTIAL_NOT_READY' (subset of failed).
 *
 * Requires operator session; GET route — no CSRF check.
 */
export default defineEventHandler(async (event) => {
  await requireSession(event);

  const appId = String(getQuery(event).appId ?? '');
  if (!appId) throw createError({ statusCode: 400, statusMessage: 'appId required' });

  const camps = await db.select().from(campaigns)
    .where(eq(campaigns.appId, appId))
    .orderBy(desc(campaigns.createdAt));

  if (camps.length === 0) return [];

  const rows = await db.select({
    campaignId: deliveries.campaignId,
    sent: sql<number>`count(*) filter (where ${deliveries.status} = 'sent')`,
    failed: sql<number>`count(*) filter (where ${deliveries.status} = 'failed')`,
    invalid: sql<number>`count(*) filter (where ${deliveries.status} = 'invalid')`,
    gaveUp: sql<number>`count(*) filter (where ${deliveries.status} = 'gave_up')`,
    notReady: sql<number>`count(*) filter (where ${deliveries.disposition} = 'CREDENTIAL_NOT_READY')`,
  }).from(deliveries)
    .where(inArray(deliveries.campaignId, camps.map((c) => c.id)))
    .groupBy(deliveries.campaignId);

  const byId = new Map(rows.map((r) => [r.campaignId, r]));

  return camps.map((c) => {
    const r = byId.get(c.id);
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      scheduledAt: c.scheduledAt ?? null,
      broadcastId: c.broadcastId ?? null,
      createdAt: c.createdAt,
      counts: {
        sent: Number(r?.sent ?? 0),
        failed: Number(r?.failed ?? 0),
        invalid: Number(r?.invalid ?? 0),
        gave_up: Number(r?.gaveUp ?? 0),
        not_ready: Number(r?.notReady ?? 0),
      },
    };
  });
});
