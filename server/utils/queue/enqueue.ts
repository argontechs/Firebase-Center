import { db } from '~~/server/db/client';
import { campaigns, devices, jobs } from '~~/server/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { JOB_TYPE_SEND, VENDOR_CHUNK_LIMIT, type SendChunkPayload } from './types';

type Group = { provider: 'fcm' | 'huawei'; platform: SendChunkPayload['platform']; deviceIds: string[] };

async function resolveAudience(campaignId: string): Promise<typeof devices.$inferSelect[]> {
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!camp) throw new Error(`campaign ${campaignId} not found`);

  // F5: enforce providerScope — filter devices to the requested provider when not 'both'
  const scopeFilter = camp.providerScope !== 'both' ? eq(devices.provider, camp.providerScope) : undefined;

  if (camp.targetType === 'all') {
    return db.select().from(devices)
      .where(and(eq(devices.appId, camp.appId), eq(devices.status, 'active'), scopeFilter))
      .orderBy(asc(devices.provider), asc(devices.platform), asc(devices.id));
  }
  if (camp.targetType === 'tokens') {
    const ids = ((camp.targetValueJsonb as { device_ids?: string[] }).device_ids) ?? [];
    if (ids.length === 0) return [];
    return db.select().from(devices)
      .where(and(eq(devices.appId, camp.appId), eq(devices.status, 'active'), inArray(devices.id, ids), scopeFilter))
      .orderBy(asc(devices.provider), asc(devices.platform), asc(devices.id));
  }
  // segment | topic are reserved enum values — rejected upstream at validation; defensive here.
  throw new Error(`unsupported target_type ${camp.targetType}`);
}

function groupByProviderPlatform(rows: typeof devices.$inferSelect[]): Group[] {
  const map = new Map<string, Group>();
  for (const d of rows) {
    const key = `${d.provider}:${d.platform}`;
    let g = map.get(key);
    if (!g) { g = { provider: d.provider, platform: d.platform as SendChunkPayload['platform'], deviceIds: [] }; map.set(key, g); }
    g.deviceIds.push(d.id);
  }
  return [...map.values()];
}

export async function enqueueCampaign(campaignId: string): Promise<{ jobsCreated: number }> {
  const audience = await resolveAudience(campaignId);
  const groups = groupByProviderPlatform(audience);

  let chunkIndex = 0;
  const rows: (typeof jobs.$inferInsert)[] = [];
  for (const g of groups) {
    const limit = VENDOR_CHUNK_LIMIT[g.provider];
    for (let i = 0; i < g.deviceIds.length; i += limit) {
      const slice = g.deviceIds.slice(i, i + limit);
      const payload: SendChunkPayload = {
        campaignId, provider: g.provider, platform: g.platform, deviceIds: slice, chunkIndex,
      };
      rows.push({
        type: JOB_TYPE_SEND,
        payloadJsonb: payload,
        idempotencyKey: `${campaignId}:${chunkIndex}`,
        campaignId,
      });
      chunkIndex += 1;
    }
  }
  if (rows.length === 0) return { jobsCreated: 0 };

  const inserted = await db.insert(jobs).values(rows)
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] })
    .returning({ id: jobs.id });
  return { jobsCreated: inserted.length };
}
