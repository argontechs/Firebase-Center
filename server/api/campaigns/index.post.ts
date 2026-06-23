import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { requireSession } from '~~/server/utils/auth/guard';
import { createCampaign } from '~~/server/utils/campaigns/create';

const Body = z.object({
  appId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string()).optional().default({}),
  mode: z.enum(['notification', 'data']).default('notification'),
  priority: z.enum(['high', 'normal']).default('high'),
  targetType: z.string(),
  targetValue: z.object({
    device_ids: z.array(z.string()).optional(),
    audience_id: z.string().optional(),
    filter: z.object({
      platform: z.enum(['android', 'ios', 'huawei', 'web']).optional(),
      provider: z.enum(['fcm', 'huawei']).optional(),
      tag: z.string().optional(),
    }).optional(),
  }).default({}),
  providerScope: z.enum(['fcm', 'huawei', 'both']).default('both'),
  image: z.string().url().optional(),
  scheduledAt: z.string().datetime().optional(),
});

/**
 * POST /api/campaigns
 *
 * Creates a campaign, validates the rendered payload against the 4 KB cap
 * (per distinct provider in the audience), enqueues it for delivery, and
 * writes a campaign_send audit event.
 *
 * Validation:
 *  - target_type 'segment' and 'topic' are reserved → 422
 *  - rendered payload > 4096 bytes for any provider → 413
 *
 * Requires operator session; CSRF is enforced by the global middleware.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event);

  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'invalid body' });
  const body = parsed.data;

  // 'topic' is still reserved; 'segment' is now supported.
  if (body.targetType === 'topic') {
    throw createError({
      statusCode: 422,
      statusMessage: `target_type 'topic' is not supported`,
    });
  }
  if (body.targetType !== 'all' && body.targetType !== 'tokens' && body.targetType !== 'segment') {
    throw createError({ statusCode: 422, statusMessage: 'invalid target_type' });
  }

  try {
    const result = await createCampaign({
      userId: session.userId,
      appId: body.appId,
      title: body.title,
      body: body.body,
      data: body.data as Record<string, string>,
      mode: body.mode,
      priority: body.priority,
      targetType: body.targetType as 'all' | 'tokens' | 'segment',
      targetValue: body.targetValue,
      providerScope: body.providerScope,
      image: body.image,
      scheduledAt: body.scheduledAt,
    });

    if (result.scheduled) {
      return { campaignId: result.campaignId, scheduled: true, jobsCreated: 0 };
    }
    return { campaignId: result.campaignId, jobsCreated: result.jobsCreated };
  } catch (e: any) {
    if (e.statusCode === 413) {
      throw createError({ statusCode: 413, statusMessage: e.message });
    }
    throw e;
  }
});
