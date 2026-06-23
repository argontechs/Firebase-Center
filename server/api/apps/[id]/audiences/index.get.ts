import { getRouterParam, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { audiences } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { countAudience, type AudienceFilter } from '~~/server/utils/audiences/resolve';

function filterOf(row: typeof audiences.$inferSelect): AudienceFilter {
  const f: AudienceFilter = {};
  if (row.platform) f.platform = row.platform;
  if (row.provider) f.provider = row.provider;
  if (row.tag) f.tag = row.tag;
  return f;
}

export default defineEventHandler(async (event) => {
  await requireSession(event);
  const appId = getRouterParam(event, 'id')!;

  const rows = await db.select().from(audiences).where(eq(audiences.appId, appId)).orderBy(audiences.createdAt);

  const result = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      count: await countAudience(row.appId, filterOf(row)),
    })),
  );

  return result;
});
