import { db } from '~~/server/db/client';
import { campaigns } from '~~/server/db/schema';
import { previewAudience } from '~~/server/utils/campaigns/audience';
import { validatePayloadSize, validateHuaweiClickAction, PayloadTooLargeError } from '~~/server/utils/payload';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { audit } from '~~/server/utils/audit';
import type { NeutralMessage, Provider } from '~~/server/utils/push/types';

export interface CreateCampaignOpts {
  userId: string;
  appId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  mode?: 'notification' | 'data';
  priority?: 'high' | 'normal';
  targetType: 'all' | 'tokens' | 'segment';
  targetValue?: {
    device_ids?: string[];
    audience_id?: string;
    filter?: { platform?: 'android' | 'ios' | 'huawei' | 'web'; provider?: 'fcm' | 'huawei'; tag?: string };
  };
  providerScope?: 'fcm' | 'huawei' | 'both';
  image?: string;
  scheduledAt?: string | null;
  broadcastId?: string | null;
}

export interface CreateCampaignResult {
  campaignId: string;
  scheduled: boolean;
  jobsCreated: number;
}

/**
 * Core campaign creation logic: validate payload size, insert campaign row,
 * and either schedule it (future scheduledAt) or enqueue it immediately.
 *
 * Extracted from POST /api/campaigns so it can be reused by the broadcast route.
 */
export async function createCampaign(opts: CreateCampaignOpts): Promise<CreateCampaignResult> {
  const {
    userId, appId, title, body, data = {}, mode = 'notification', priority = 'high',
    targetType, targetValue = {}, providerScope = 'both', image, scheduledAt, broadcastId,
  } = opts;

  const message: NeutralMessage = {
    title,
    body,
    data: data as Record<string, string>,
    mode,
    priority,
    ...(image ? { image } : {}),
  };

  // Validate Huawei click_action.type:1 requirement
  validateHuaweiClickAction(message);

  // Resolve the audience and validate payload size per distinct provider.
  const groups = await previewAudience(appId, targetType, targetValue, providerScope);
  const providers = [...new Set(groups.map((g) => g.provider))] as Provider[];
  const checkProviders = providers.length > 0 ? providers : (['fcm'] as Provider[]);

  for (const provider of checkProviders) {
    try {
      validatePayloadSize(message, provider);
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        throw Object.assign(new Error(`payload too large for ${provider}: ${e.bytes} bytes (max 4096)`), {
          statusCode: 413,
        });
      }
      throw e;
    }
  }

  // Determine if this is a future-scheduled campaign.
  const now = new Date();
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const isScheduled = scheduledDate !== null && scheduledDate > now;

  if (isScheduled) {
    // Insert as scheduled — do not enqueue yet.
    const [camp] = await db.insert(campaigns).values({
      appId,
      title,
      body,
      dataJsonb: data,
      mode,
      priority,
      targetType,
      targetValueJsonb: targetValue,
      providerScope,
      status: 'scheduled',
      scheduledAt: scheduledDate,
      broadcastId: broadcastId ?? undefined,
      createdBy: userId,
    }).returning();

    await audit({
      userId,
      action: 'campaign_scheduled',
      targetType: 'campaign',
      targetId: camp.id,
      meta: { appId, targetType, scheduledAt, broadcastId: broadcastId ?? undefined },
    });

    return { campaignId: camp.id, scheduled: true, jobsCreated: 0 };
  }

  // Insert the campaign row.
  const [camp] = await db.insert(campaigns).values({
    appId,
    title,
    body,
    dataJsonb: data,
    mode,
    priority,
    targetType,
    targetValueJsonb: targetValue,
    providerScope,
    status: 'queued',
    broadcastId: broadcastId ?? undefined,
    createdBy: userId,
  }).returning();

  // Enqueue delivery jobs.
  const { jobsCreated } = await enqueueCampaign(camp.id);

  // Audit the send event.
  await audit({
    userId,
    action: 'campaign_send',
    targetType: 'campaign',
    targetId: camp.id,
    meta: { appId, targetType, jobsCreated, broadcastId: broadcastId ?? undefined },
  });

  return { campaignId: camp.id, scheduled: false, jobsCreated };
}
