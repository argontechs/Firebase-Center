/**
 * POST /api/v1/messages — programmatic send endpoint (SA.3)
 *
 * Auth: Bearer send-key (company-scoped; NOT an operator session).
 * CSRF: exempt — /api/v1/ is in the middleware exemption list.
 * Returns: 202 { campaignId, jobsCreated }
 *
 * Security checklist:
 *  - resolveActiveSendKey → companyId (401 for unknown/revoked)
 *  - per-key + per-IP sliding-window rate-limit
 *  - app must belong to the key's company (403 else — no cross-Site send)
 *  - payload size ≤ 4096 bytes (validated via validatePayloadSize)
 *  - Addendum-D click_action.type:1 check (validateHuaweiClickAction)
 *  - campaign row created with createdBy = null (API sends)
 *  - enqueueCampaign for async delivery
 *  - audit 'api_send'
 */
import { z } from 'zod';
import { defineEventHandler, readBody, createError, getHeader, getRequestIP, setResponseStatus } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { apps, campaigns } from '~~/server/db/schema';
import { resolveActiveSendKey } from '~~/server/utils/send-keys';
import { rateLimit } from '~~/server/utils/rate-limit';
import { validatePayloadSize, validateHuaweiClickAction, PayloadTooLargeError, ClickActionError } from '~~/server/utils/payload';
import { enqueueCampaign } from '~~/server/utils/queue/enqueue';
import { audit } from '~~/server/utils/audit';
import type { NeutralMessage } from '~~/server/utils/push/types';

const WINDOW_MS = 60_000;
function sendLimit(): number {
  return Number(process.env.SEND_RATE_LIMIT ?? 600);
}

const TargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('tokens'), deviceIds: z.array(z.string().uuid()) }),
]);

const Body = z.object({
  appId: z.string().uuid(),
  target: TargetSchema,
  notification: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  data: z.record(z.string()).optional().default({}),
  mode: z.enum(['notification', 'data']).optional().default('notification'),
  priority: z.enum(['high', 'normal']).optional().default('high'),
});

export default defineEventHandler(async (event) => {
  // 1. Extract + validate bearer token (401 for missing/malformed)
  const authHeader = getHeader(event, 'authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    throw createError({ statusCode: 401, statusMessage: 'missing bearer token' });
  }
  const rawKey = match[1];

  // 2. Resolve send key → companyId (401 for unknown/revoked)
  const resolved = await resolveActiveSendKey(db, rawKey);
  if (!resolved) {
    throw createError({ statusCode: 401, statusMessage: 'invalid or revoked send key' });
  }
  const { id: keyId, companyId } = resolved;

  // 3. Per-key + per-IP rate limiting
  const limit = sendLimit();
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';
  rateLimit(`send:key:${keyId}`, limit, WINDOW_MS);
  rateLimit(`send:ip:${ip}`, limit, WINDOW_MS);

  // 4. Parse and validate the request body
  const rawBody = await readBody<Record<string, unknown>>(event);
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: 'invalid request body' });
  }
  const body = parsed.data;

  // 5. Assert the appId belongs to this company (403 if not — no cross-Site sends)
  const [appRow] = await db.select({ id: apps.id, companyId: apps.companyId })
    .from(apps)
    .where(eq(apps.id, body.appId));
  if (!appRow) {
    throw createError({ statusCode: 404, statusMessage: 'app not found' });
  }
  if (appRow.companyId !== companyId) {
    throw createError({ statusCode: 403, statusMessage: 'send key is not authorized for this app' });
  }

  // 6. Build the neutral message for payload validation
  const message: NeutralMessage = {
    title: body.notification.title,
    body: body.notification.body,
    data: body.data as Record<string, string>,
    mode: body.mode,
    priority: body.priority,
  };

  // 7. Addendum-D: validate Huawei click_action.type:1 requirement
  try {
    validateHuaweiClickAction(message);
  } catch (e) {
    if (e instanceof ClickActionError) {
      throw createError({ statusCode: 400, statusMessage: e.message });
    }
    throw e;
  }

  // 8. Validate payload size for both providers (use fcm as the baseline check when
  //    no devices are seeded yet; this mirrors the campaign create route's approach).
  for (const provider of ['fcm', 'huawei'] as const) {
    try {
      validatePayloadSize(message, provider);
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        throw createError({
          statusCode: 400,
          statusMessage: `payload too large for ${provider}: ${e.bytes} bytes (max 4096)`,
        });
      }
      throw e;
    }
  }

  // 9. Map target to campaign schema fields
  const targetType = body.target.type; // 'all' | 'tokens'
  const targetValueJsonb =
    body.target.type === 'tokens'
      ? { device_ids: body.target.deviceIds }
      : {};

  // 10. Insert the campaign row (createdBy = null for API sends)
  const [camp] = await db.insert(campaigns).values({
    appId: body.appId,
    title: body.notification.title,
    body: body.notification.body,
    dataJsonb: body.data,
    mode: body.mode,
    priority: body.priority,
    targetType,
    targetValueJsonb,
    providerScope: 'both',
    status: 'queued',
    createdBy: null,
  }).returning();

  // 11. Enqueue delivery jobs
  const { jobsCreated } = await enqueueCampaign(camp.id);

  // 12. Audit the send event
  await audit({
    userId: null,
    action: 'api_send',
    targetType: 'campaign',
    targetId: camp.id,
    meta: { companyId, appId: body.appId, keyId },
  });

  setResponseStatus(event, 202);
  return { campaignId: camp.id, jobsCreated };
});
