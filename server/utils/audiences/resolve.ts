import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';

export interface AudienceFilter { platform?: 'android'|'ios'|'huawei'|'web'; provider?: 'fcm'|'huawei'; tag?: string }

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
