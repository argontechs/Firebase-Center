import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { previewAudience } from '~~/server/utils/campaigns/audience';
import { validatePayloadSize, validateHuaweiClickAction, PayloadTooLargeError } from '~~/server/utils/payload';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { audit } from '~~/server/utils/audit';
import type { NeutralMessage, Provider } from '~~/server/utils/push/types';

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

  const message: NeutralMessage = {
    title: body.title,
    body: body.body,
    data: body.data as Record<string, string>,
    mode: body.mode,
    priority: body.priority,
    ...(body.image ? { image: body.image } : {}),
  };

  // Addendum-D: validate Huawei click_action.type:1 requirement
  validateHuaweiClickAction(message);

  // Resolve the audience and validate payload size per distinct provider.
  const groups = await previewAudience(body.appId, body.targetType, body.targetValue, body.providerScope);
  const providers = [...new Set(groups.map((g) => g.provider))] as Provider[];
  const checkProviders = providers.length > 0 ? providers : (['fcm'] as Provider[]);

  for (const provider of checkProviders) {
    try {
      validatePayloadSize(message, provider);
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        throw createError({
          statusCode: 413,
          statusMessage: `payload too large for ${provider}: ${e.bytes} bytes (max 4096)`,
        });
      }
      throw e;
    }
  }

  // Determine if this is a future-scheduled campaign.
  const now = new Date();
  const scheduledDate = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const isScheduled = scheduledDate !== null && scheduledDate > now;

  if (isScheduled) {
    // Insert as scheduled — do not enqueue yet.
    const [camp] = await db.insert(campaigns).values({
      appId: body.appId,
      title: body.title,
      body: body.body,
      dataJsonb: body.data,
      mode: body.mode,
      priority: body.priority,
      targetType: body.targetType,
      targetValueJsonb: body.targetValue,
      providerScope: body.providerScope,
      status: 'scheduled',
      scheduledAt: scheduledDate,
      createdBy: session.userId,
    }).returning();

    await audit({
      userId: session.userId,
      action: 'campaign_scheduled',
      targetType: 'campaign',
      targetId: camp.id,
      meta: { appId: body.appId, targetType: body.targetType, scheduledAt: body.scheduledAt },
    });

    return { campaignId: camp.id, scheduled: true, jobsCreated: 0 };
  }

  // Insert the campaign row.
  const [camp] = await db.insert(campaigns).values({
    appId: body.appId,
    title: body.title,
    body: body.body,
    dataJsonb: body.data,
    mode: body.mode,
    priority: body.priority,
    targetType: body.targetType,
    targetValueJsonb: body.targetValue,
    providerScope: body.providerScope,
    status: 'queued',
    createdBy: session.userId,
  }).returning();

  // Enqueue delivery jobs.
  const { jobsCreated } = await enqueueCampaign(camp.id);

  // Audit the send event.
  await audit({
    userId: session.userId,
    action: 'campaign_send',
    targetType: 'campaign',
    targetId: camp.id,
    meta: { appId: body.appId, targetType: body.targetType, jobsCreated },
  });

  return { campaignId: camp.id, jobsCreated };
});
