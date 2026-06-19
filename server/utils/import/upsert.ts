import { sql } from 'drizzle-orm';
import { devices } from '~~/server/db/schema';
import type { Db } from '~~/server/db/client';
import type { ValidRow } from './validate';

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * Upserts ValidRow[] into `devices` keyed on (app_id, token).
 * Existing rows are updated in-place; new rows are inserted.
 *
 * Uses the Postgres `xmax = 0` heuristic to distinguish inserts from updates
 * that result from ON CONFLICT DO UPDATE: a freshly inserted tuple always has
 * xmax = 0, while a row that was updated by the conflict clause has xmax set
 * to the transaction XID. This requires real Postgres (not pglite/pg-mem).
 */
export async function upsertDevices(db: Db, appId: string, rows: ValidRow[]): Promise<UpsertResult> {
  let inserted = 0;
  let updated = 0;

  for (const r of rows) {
    const res = await db
      .insert(devices)
      .values({
        appId,
        provider: r.provider,
        platform: r.platform,
        token: r.token,
        externalUserId: r.externalUserId,
        attributesJsonb: r.attributes,
        status: 'active',
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [devices.appId, devices.token],
        set: {
          provider: r.provider,
          platform: r.platform,
          externalUserId: r.externalUserId,
          attributesJsonb: r.attributes,
          status: 'active',
          lastSeenAt: new Date(),
        },
      })
      .returning({ wasInserted: sql<boolean>`(xmax = 0)` });

    if (res[0]?.wasInserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}
