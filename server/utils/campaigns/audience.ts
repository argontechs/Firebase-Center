import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { resolveCredential } from '~~/server/utils/credentials/resolve';
import type { Provider, DevicePlatform } from '~~/server/utils/push/types';
import { resolveAudienceDevices, type AudienceFilter } from '~~/server/utils/audiences/resolve';

export type ProviderScope = 'fcm' | 'huawei' | 'both';

export interface GroupPreview {
  provider: Provider;
  platform: DevicePlatform;
  count: number;
  ready: boolean;
}

/**
 * Returns the audience broken down per (provider, platform) group, with
 * recipient counts and credential readiness for each group.
 *
 * @param appId         - the App to query devices for
 * @param targetType    - 'all' = all active devices; 'tokens' = explicit device_ids subset; 'segment' = filter-based
 * @param targetValue   - for 'tokens': { device_ids: string[] }; for 'segment': { filter: AudienceFilter }
 * @param providerScope - F5: restrict audience to a single provider ('fcm'|'huawei') or keep 'both'
 */
export async function previewAudience(
  appId: string,
  targetType: 'all' | 'tokens' | 'segment',
  targetValue: { device_ids?: string[]; filter?: AudienceFilter },
  providerScope: ProviderScope = 'both',
): Promise<GroupPreview[]> {
  // F5: filter devices to the requested provider when not 'both'
  const scopeFilter = providerScope !== 'both' ? eq(devices.provider, providerScope) : undefined;
  const baseWhere = and(eq(devices.appId, appId), eq(devices.status, 'active'), scopeFilter);

  let rows: typeof devices.$inferSelect[];

  if (targetType === 'segment') {
    const segmentRows = await resolveAudienceDevices(appId, targetValue.filter ?? {});
    rows = providerScope === 'both' ? segmentRows : segmentRows.filter(d => d.provider === providerScope);
  } else {
    rows =
      targetType === 'tokens'
        ? await db.select().from(devices).where(
            and(
              baseWhere,
              inArray(
                devices.id,
                targetValue.device_ids?.length
                  ? targetValue.device_ids
                  : ['00000000-0000-0000-0000-000000000000'], // empty-safe sentinel
              ),
            ),
          )
        : await db.select().from(devices).where(baseWhere);
  }

  // Aggregate by (provider, platform)
  const groupMap = new Map<string, GroupPreview>();
  for (const d of rows) {
    const key = `${d.provider}:${d.platform}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groupMap.set(key, { provider: d.provider, platform: d.platform as DevicePlatform, count: 1, ready: false });
    }
  }

  // Resolve credential readiness for each unique (provider, platform) group
  for (const group of groupMap.values()) {
    const result = await resolveCredential(appId, group.provider, group.platform);
    group.ready = result.ready;
  }

  return [...groupMap.values()];
}
