/**
 * POST /api/apps/:id/devices/manual
 *
 * Operator manual device add — distinct from the bearer-ingest route at
 * POST /api/apps/:id/devices which requires an ingest key.
 *
 * Body: { token, provider, platform, externalUserId?, tags?: string[] }
 * Auth: requireSession (operator session + CSRF via global middleware)
 * Errors:
 *   422 — validation failure
 *   409 — duplicate (app_id, token)
 */
import { readBody, getRouterParam, createError, setResponseStatus, defineEventHandler } from 'h3';
import { z } from 'zod';
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { isUniqueViolation } from '~~/server/utils/db-errors';
import { audit } from '~~/server/utils/audit';

const bodySchema = z.object({
  token: z.string().min(1, 'token is required'),
  provider: z.enum(['fcm', 'huawei']),
  platform: z.enum(['android', 'ios', 'huawei', 'web']),
  externalUserId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const appId = getRouterParam(event, 'id')!;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const { token, provider, platform, externalUserId, tags } = parsed.data;

  try {
    const [row] = await db.insert(devices).values({
      appId,
      token,
      provider,
      platform,
      status: 'active',
      externalUserId: externalUserId ?? null,
      tags: tags ?? [],
    }).returning();

    await audit({
      userId: session.userId,
      action: 'device_add_manual',
      targetType: 'device',
      targetId: row!.id,
      meta: { appId, provider, platform },
    });

    setResponseStatus(event, 201);
    return { id: row!.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'A device with that token already exists for this app' });
    }
    throw err;
  }
});
