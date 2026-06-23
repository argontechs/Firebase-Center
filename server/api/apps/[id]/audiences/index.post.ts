import { readBody, getRouterParam, createError, setResponseStatus, defineEventHandler } from 'h3';
import { z } from 'zod';
import { db } from '~~/server/db/client';
import { audiences } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { isUniqueViolation } from '~~/server/utils/db-errors';
import { audit } from '~~/server/utils/audit';
import { countAudience, type AudienceFilter } from '~~/server/utils/audiences/resolve';

const bodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  platform: z.enum(['android', 'ios', 'huawei', 'web']).optional(),
  provider: z.enum(['fcm', 'huawei']).optional(),
  tag: z.string().optional(),
});

function filterOf(row: typeof audiences.$inferSelect): AudienceFilter {
  const f: AudienceFilter = {};
  if (row.platform) f.platform = row.platform;
  if (row.provider) f.provider = row.provider;
  if (row.tag) f.tag = row.tag;
  return f;
}

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const appId = getRouterParam(event, 'id')!;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const { name, platform, provider, tag } = parsed.data;

  try {
    const [row] = await db.insert(audiences).values({
      appId,
      name,
      platform: platform ?? null,
      provider: provider ?? null,
      tag: tag ?? null,
      createdBy: session.userId,
    }).returning();

    await audit({ userId: session.userId, action: 'audience_save', targetType: 'audience', targetId: row!.id, meta: { appId, name } });

    setResponseStatus(event, 201);
    return { ...row, count: await countAudience(row!.appId, filterOf(row!)) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'An audience with that name already exists for this app' });
    }
    throw err;
  }
});
