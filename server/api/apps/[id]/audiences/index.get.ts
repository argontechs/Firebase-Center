import { getRouterParam, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { audiences } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { countAudience, filterOf, type AudienceFilter } from '~~/server/utils/audiences/resolve';

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
