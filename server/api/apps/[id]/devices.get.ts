import { getQuery, getRouterParam, defineEventHandler } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const appId = getRouterParam(event, 'id')!;
  const q = getQuery(event);

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

  const filters: SQL[] = [eq(devices.appId, appId)];
  if (typeof q.status === 'string') filters.push(eq(devices.status, q.status as any));
  if (typeof q.provider === 'string') filters.push(eq(devices.provider, q.provider as any));
  if (typeof q.platform === 'string') filters.push(eq(devices.platform, q.platform as any));
  const where = and(...filters);

  const rows = await db.select().from(devices).where(where).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(devices).where(where);
  return { devices: rows, total: count };
});
