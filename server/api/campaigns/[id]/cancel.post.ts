import { defineEventHandler, getRouterParam, createError } from 'h3';
import { eq, and } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';

/**
 * POST /api/campaigns/:id/cancel
 *
 * Cancels a scheduled campaign.
 *
 * - 200 { ok: true }  — campaign was scheduled and is now canceled.
 * - 404               — no campaign with that id exists.
 * - 409               — campaign exists but is not in 'scheduled' status (already queued/sending/done/etc.)
 *
 * Requires operator session; CSRF is enforced by the global middleware.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event);

  const id = getRouterParam(event, 'id') ?? '';

  // Check whether the campaign exists at all first
  const [existing] = await db.select({ id: campaigns.id, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, id));

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'campaign not found' });
  }

  if (existing.status !== 'scheduled') {
    throw createError({
      statusCode: 409,
      statusMessage: `campaign cannot be canceled (current status: ${existing.status})`,
    });
  }

  // UPDATE ... WHERE status = 'scheduled' to guard against race conditions
  await db.update(campaigns)
    .set({ status: 'canceled' })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, 'scheduled')));

  await audit({
    userId: session.userId,
    action: 'campaign_cancel',
    targetType: 'campaign',
    targetId: id,
  });

  return { ok: true };
});
