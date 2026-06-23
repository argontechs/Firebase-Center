import { readBody, getRouterParam, createError, defineEventHandler } from 'h3';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '~~/server/db/client';
import { audiences } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';
import { countAudience, type AudienceFilter } from '~~/server/utils/audiences/resolve';

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  platform: z.enum(['android', 'ios', 'huawei', 'web']).nullable().optional(),
  provider: z.enum(['fcm', 'huawei']).nullable().optional(),
  tag: z.string().nullable().optional(),
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
  const aid = getRouterParam(event, 'aid')!;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const patch: Record<string, unknown> = {};
  const { name, platform, provider, tag } = parsed.data;
  if (name !== undefined) patch['name'] = name;
  if (platform !== undefined) patch['platform'] = platform;
  if (provider !== undefined) patch['provider'] = provider;
  if (tag !== undefined) patch['tag'] = tag;

  const [row] = await db.update(audiences)
    .set(patch as any)
    .where(and(eq(audiences.id, aid), eq(audiences.appId, appId)))
    .returning();

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Audience not found' });

  await audit({ userId: session.userId, action: 'audience_save', targetType: 'audience', targetId: row.id, meta: { appId, patch } });

  return { ...row, count: await countAudience(row.appId, filterOf(row)) };
});
