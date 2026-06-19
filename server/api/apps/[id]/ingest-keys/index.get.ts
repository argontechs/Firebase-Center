import { getRouterParam, defineEventHandler } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { appIngestKeys } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const appId = getRouterParam(event, 'id')!;
  return db
    .select({
      id: appIngestKeys.id,
      keyPrefix: appIngestKeys.keyPrefix,
      version: appIngestKeys.version,
      label: appIngestKeys.label,
      createdAt: appIngestKeys.createdAt,
      revokedAt: appIngestKeys.revokedAt,
    })
    .from(appIngestKeys)
    .where(eq(appIngestKeys.appId, appId));
});
