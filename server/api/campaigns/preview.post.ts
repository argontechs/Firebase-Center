import { z } from 'zod';
import { defineEventHandler, readBody, createError } from 'h3';
import { requireSession } from '~~/server/utils/auth/guard';
import { previewAudience } from '~~/server/utils/campaigns/audience';
import { validatePayloadSize, renderBodyForSizing, PayloadTooLargeError } from '~~/server/utils/payload';
import type { NeutralMessage, Provider } from '~~/server/utils/push/types';

const Body = z.object({
  appId: z.string().uuid(),
  mode: z.enum(['notification', 'data']).default('notification'),
  priority: z.enum(['high', 'normal']).default('high'),
  targetType: z.enum(['all', 'tokens', 'segment']),
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
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string()).optional().default({}),
  image: z.string().url().optional(),
});

/**
 * POST /api/campaigns/preview
 *
 * Returns the audience broken down per (provider, platform) with recipient
 * counts, credential readiness, rendered payload byte total, and whether
 * the payload fits within the 4096-byte cap.
 *
 * Requires operator session (CSRF is enforced by the global middleware).
 */
export default defineEventHandler(async (event) => {
  await requireSession(event);

  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'invalid body' });
  const body = parsed.data;

  const message: NeutralMessage = {
    title: body.title,
    body: body.body,
    data: body.data as Record<string, string>,
    mode: body.mode,
    priority: body.priority,
    ...(body.image ? { image: body.image } : {}),
  };

  const byGroup = await previewAudience(body.appId, body.targetType, body.targetValue ?? {}, body.providerScope);

  // Measure payload size per distinct provider; track overall byte count and limit flag.
  const providers = [...new Set(byGroup.map((g) => g.provider))] as Provider[];
  // Default to FCM if no devices in audience yet (so preview still returns byte estimates)
  const checkProviders = providers.length > 0 ? providers : (['fcm'] as Provider[]);

  let totalBytes = 0;
  let withinLimit = true;

  for (const provider of checkProviders) {
    try {
      validatePayloadSize(message, provider);
      // Use the same renderBodyForSizing path that validatePayloadSize uses internally
      // so the byte count reflects the true provider-envelope size (FCM +29 B overhead,
      // Huawei +90 B overhead) rather than a raw title/body/data JSON slice.
      const sizeBytes = Buffer.byteLength(JSON.stringify(renderBodyForSizing(message, provider)), 'utf8');
      totalBytes = Math.max(totalBytes, sizeBytes);
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        withinLimit = false;
        totalBytes = Math.max(totalBytes, e.bytes);
      } else {
        throw e;
      }
    }
  }

  return { byGroup, totalBytes, withinLimit };
});
