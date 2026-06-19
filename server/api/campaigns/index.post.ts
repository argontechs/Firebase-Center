import { defineEventHandler, readBody, createError } from 'h3';
import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { previewAudience } from '~~/server/utils/campaigns/audience';
import { validatePayloadSize, validateHuaweiClickAction, PayloadTooLargeError } from '~~/server/utils/payload';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { audit } from '~~/server/utils/audit';
import type { NeutralMessage, Provider } from '~~/server/utils/push/types';

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

  const body = await readBody(event);

  // Reserved enum values — rejected until built (design §6/§10).
  if (body.targetType === 'segment' || body.targetType === 'topic') {
    throw createError({
      statusCode: 422,
      statusMessage: `target_type '${body.targetType}' is not supported in v1`,
    });
  }
  if (body.targetType !== 'all' && body.targetType !== 'tokens') {
    throw createError({ statusCode: 422, statusMessage: 'invalid target_type' });
  }

  const message: NeutralMessage = {
    title: body.title ?? '',
    body: body.body ?? '',
    data: (body.data ?? {}) as Record<string, string>,
    mode: body.mode ?? 'notification',
    priority: body.priority ?? 'high',
    ...(body.image ? { image: body.image } : {}),
  };

  // Addendum-D: validate Huawei click_action.type:1 requirement
  validateHuaweiClickAction(message);

  // Resolve the audience and validate payload size per distinct provider.
  const groups = await previewAudience(body.appId, body.targetType, body.targetValue ?? {});
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

  // Insert the campaign row.
  const [camp] = await db.insert(campaigns).values({
    appId: body.appId,
    title: body.title,
    body: body.body,
    dataJsonb: body.data ?? {},
    mode: body.mode ?? 'notification',
    priority: body.priority ?? 'high',
    targetType: body.targetType,
    targetValueJsonb: body.targetValue ?? {},
    providerScope: body.providerScope ?? 'both',
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
