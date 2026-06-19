import { db } from '~~/server/db/client';
import { jobs, campaigns, devices, deliveries } from '~~/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { resolveCredential } from '~~/server/utils/credentials/resolve';
import { getAdapter } from '~~/server/utils/push/registry';
import { getAccessToken } from '~~/server/utils/push/token-cache';
import type { NeutralMessage, Recipient, DeliveryResult } from '~~/server/utils/push/types';
import { type SendChunkPayload } from './types';

export async function claimNextJob(): Promise<typeof jobs.$inferSelect | null> {
  // Atomic claim via raw SQL: UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED).
  // Returns snake_case columns, so we extract only the id and re-fetch with Drizzle for casing.
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs SET status = 'running', claimed_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_after <= now()
      ORDER BY run_after ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);
  const rawRows = (result as unknown as { rows: { id: string }[] }).rows
    ?? (result as unknown as { id: string }[]);
  const claimed = rawRows[0];
  if (!claimed) return null;

  const [row] = await db.select().from(jobs).where(eq(jobs.id, claimed.id));
  return row ?? null;
}

function toNeutral(camp: typeof campaigns.$inferSelect): NeutralMessage {
  return {
    title: camp.title,
    body: camp.body,
    data: (camp.dataJsonb as Record<string, string>) ?? {},
    mode: camp.mode,
    priority: camp.priority,
  };
}

async function recordCredentialNotReady(
  campaignId: string,
  rows: typeof devices.$inferSelect[],
) {
  if (rows.length === 0) return;
  await db.insert(deliveries).values(
    rows.map((d) => ({
      campaignId,
      deviceId: d.id,
      provider: d.provider,
      platform: d.platform,
      token: d.token,
      status: 'failed' as const,
      disposition: 'CREDENTIAL_NOT_READY',
    })),
  );
}

async function writeResults(
  campaignId: string,
  rows: typeof devices.$inferSelect[],
  results: DeliveryResult[],
) {
  const byToken = new Map(rows.map((d) => [d.token, d]));
  const toInvalidate: string[] = [];

  const values = results.map((res) => {
    const dev = res.deviceId
      ? rows.find((d) => d.id === res.deviceId)
      : byToken.get(res.token);
    if (res.disposition === 'DELETE_TOKEN' && dev) {
      toInvalidate.push(dev.id);
    }
    return {
      campaignId,
      deviceId: dev?.id ?? null,
      provider: (dev?.provider ?? rows[0]?.provider) as typeof deliveries.$inferInsert['provider'],
      platform: (dev?.platform ?? rows[0]?.platform) as typeof deliveries.$inferInsert['platform'],
      token: res.token,
      status: res.status as typeof deliveries.$inferInsert['status'],
      disposition: res.disposition ?? null,
      errorCode: res.errorCode ?? null,
      responseMeta: res.responseMeta ?? null,
      sentAt: res.status === 'sent' ? new Date() : null,
    };
  });

  await db.insert(deliveries).values(values);

  if (toInvalidate.length > 0) {
    await db
      .update(devices)
      .set({ status: 'invalid' })
      .where(inArray(devices.id, toInvalidate));
  }
}

async function processSendChunk(job: typeof jobs.$inferSelect): Promise<void> {
  const payload = job.payloadJsonb as SendChunkPayload;
  const [camp] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, payload.campaignId));
  if (!camp) throw new Error(`campaign ${payload.campaignId} missing`);

  const rows = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.appId, camp.appId),
        inArray(devices.id, payload.deviceIds),
      ),
    );
  if (rows.length === 0) return;

  const resolved = await resolveCredential(camp.appId, payload.provider, payload.platform);
  if (!resolved.ready) {
    await recordCredentialNotReady(payload.campaignId, rows);
    return;
  }

  const adapter = getAdapter(payload.provider);
  await getAccessToken(resolved.credential, (c) => adapter.mintToken(c));
  const wire = adapter.render(toNeutral(camp));
  const recipients: Recipient[] = rows.map((d) => ({
    deviceId: d.id,
    token: d.token,
    platform: d.platform,
  }));
  const results: DeliveryResult[] = await adapter.send(resolved.credential, wire, recipients);
  await writeResults(payload.campaignId, rows, results);
}

export async function runWorkerOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  try {
    await processSendChunk(job);
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id));
  } catch (err) {
    await db
      .update(jobs)
      .set({ status: 'failed', lastError: String((err as Error)?.message ?? err) })
      .where(eq(jobs.id, job.id));
  }
  return true;
}
