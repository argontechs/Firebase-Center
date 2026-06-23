import { getRouterParam, createError, setResponseStatus, defineEventHandler } from 'h3';
import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { audiences } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const appId = getRouterParam(event, 'id')!;
  const aid = getRouterParam(event, 'aid')!;

  const [row] = await db.delete(audiences)
    .where(and(eq(audiences.id, aid), eq(audiences.appId, appId)))
    .returning();

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Audience not found' });

  await audit({ userId: session.userId, action: 'audience_delete', targetType: 'audience', targetId: row.id, meta: { appId } });

  setResponseStatus(event, 204);
  return null;
});
