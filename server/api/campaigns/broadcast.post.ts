import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { requireSession } from '~~/server/utils/auth/guard';
import { createCampaign } from '~~/server/utils/campaigns/create';
import { audit } from '~~/server/utils/audit';

const Body = z.object({
  appIds: z.array(z.string().uuid()).min(1, 'appIds must not be empty'),
  message: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    data: z.record(z.string()).optional().default({}),
    mode: z.enum(['notification', 'data']).default('notification'),
    priority: z.enum(['high', 'normal']).default('high'),
    image: z.string().url().optional(),
  }),
  recipients: z.object({
    type: z.enum(['all', 'tokens', 'segment']),
    device_ids: z.array(z.string()).optional(),
    audience_id: z.string().optional(),
    filter: z.object({
      platform: z.enum(['android', 'ios', 'huawei', 'web']).optional(),
      provider: z.enum(['fcm', 'huawei']).optional(),
      tag: z.string().optional(),
    }).optional(),
  }),
  providerScope: z.enum(['fcm', 'huawei', 'both']).default('both'),
  scheduledAt: z.string().datetime().optional(),
});

/**
 * POST /api/campaigns/broadcast
 *
 * Creates one campaign per app, all sharing a single broadcastId.
 * Each campaign is either enqueued immediately or stored as 'scheduled'
 * depending on scheduledAt.
 *
 * Requires operator session; CSRF is enforced by the global middleware.
 */
export default defineEventHandler(async (event) => {
  const session = await requireSession(event);

  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'invalid body' });
  const body = parsed.data;

  const broadcastId = crypto.randomUUID();

  // Broadcast only supports 'all' or filter-only 'segment' (no audience_id, no device_ids/tokens)
  if (body.recipients.type === 'tokens') {
    throw createError({ statusCode: 422, statusMessage: 'Broadcast does not support type "tokens"' });
  }
  if (body.recipients.type === 'segment' && body.recipients.audience_id) {
    throw createError({ statusCode: 422, statusMessage: 'Broadcast does not support audience_id; use a filter instead' });
  }

  const campaignIds: string[] = [];

  const targetValue = {
    device_ids: body.recipients.device_ids,
    audience_id: body.recipients.audience_id,
    filter: body.recipients.filter,
  };

  for (const appId of body.appIds) {
    try {
      const result = await createCampaign({
        userId: session.userId,
        appId,
        title: body.message.title,
        body: body.message.body,
        data: body.message.data as Record<string, string>,
        mode: body.message.mode,
        priority: body.message.priority,
        targetType: body.recipients.type,
        targetValue,
        providerScope: body.providerScope,
        image: body.message.image,
        scheduledAt: body.scheduledAt,
        broadcastId,
      });
      campaignIds.push(result.campaignId);
    } catch (e: any) {
      if (e.statusCode === 413) {
        throw createError({ statusCode: 413, statusMessage: e.message });
      }
      throw e;
    }
  }

  await audit({
    userId: session.userId,
    action: 'campaign_broadcast',
    meta: { broadcastId, appIds: body.appIds, campaignIds },
  });

  return { broadcastId, campaignIds };
});
