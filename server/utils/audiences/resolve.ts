import { db } from '~~/server/db/client';
import { devices, audiences } from '~~/server/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { createError } from 'h3';

export interface AudienceFilter { platform?: 'android'|'ios'|'huawei'|'web'; provider?: 'fcm'|'huawei'; tag?: string }

export function filterOf(row: typeof audiences.$inferSelect): AudienceFilter {
  const f: AudienceFilter = {};
  if (row.platform) f.platform = row.platform;
  if (row.provider) f.provider = row.provider;
  if (row.tag) f.tag = row.tag;
  return f;
}

export async function filterForTarget(
  appId: string,
  targetValue: { audience_id?: string; filter?: AudienceFilter },
): Promise<AudienceFilter> {
  if (targetValue.audience_id) {
    const [row] = await db.select().from(audiences)
      .where(and(eq(audiences.id, targetValue.audience_id), eq(audiences.appId, appId)));
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: `Audience ${targetValue.audience_id} not found for this app` });
    }
    return filterOf(row);
  }
  return targetValue.filter ?? {};
}

export function audienceWhere(appId: string, filter: AudienceFilter): SQL {
  const parts = [eq(devices.appId, appId), eq(devices.status, 'active')];
  if (filter.platform) parts.push(eq(devices.platform, filter.platform));
  if (filter.provider) parts.push(eq(devices.provider, filter.provider));
  if (filter.tag) parts.push(sql`${filter.tag} = ANY(${devices.tags})`);
  return and(...parts) as SQL;
}

export function resolveAudienceDevices(appId: string, filter: AudienceFilter) {
  return db.select().from(devices).where(audienceWhere(appId, filter))
    .orderBy(devices.provider, devices.platform, devices.id);
}

export async function countAudience(appId: string, filter: AudienceFilter): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(devices).where(audienceWhere(appId, filter));
  return r?.n ?? 0;
}
