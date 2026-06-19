import { db } from '~~/server/db/client';
import { jobs, campaigns, devices, deliveries } from '~~/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { resolveCredential } from '~~/server/utils/credentials/resolve';
import { getAdapter } from '~~/server/utils/push/registry';
import { getAccessToken, invalidateToken } from '~~/server/utils/push/token-cache';
import { validatePayloadSize, PayloadTooLargeError } from '~~/server/utils/payload';
import type { NeutralMessage, Recipient, DeliveryResult, Disposition } from '~~/server/utils/push/types';
import { type SendChunkPayload } from './types';
import { nextRunAfter } from './backoff';

/**
 * Dispositions that fail the job terminally and are never retried.
 * Any result carrying one of these dispositions causes the job to transition
 * immediately to `failed` with a `last_error` explaining the cause.
 */
export const NON_TRANSIENT: Disposition[] = [
  'REAUTH',
  'FIX_CREDENTIALS',
  'FIX_REQUEST',
  'CREDENTIAL_NOT_READY',
];

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

/**
 * Persists final delivery results, skipping RETRY_BACKOFF entries (they are
 * not final yet — the job will be requeued for them).
 * Marks DELETE_TOKEN devices as invalid in the devices table.
 */
async function writeResults(
  campaignId: string,
  rows: typeof devices.$inferSelect[],
  results: DeliveryResult[],
) {
  // Skip retryable entries — they are not final and will be retried.
  const final = results.filter((r) => r.disposition !== 'RETRY_BACKOFF');
  if (final.length === 0) return;

  const byToken = new Map(rows.map((d) => [d.token, d]));
  const toInvalidate: string[] = [];

  const values = final.map((res) => {
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

  if (values.length === 0) return;
  await db.insert(deliveries).values(values);

  if (toInvalidate.length > 0) {
    await db
      .update(devices)
      .set({ status: 'invalid' })
      .where(inArray(devices.id, toInvalidate));
  }
}

/**
 * Classify send results into retryable vs. terminal non-transient buckets.
 */
function classify(results: DeliveryResult[]) {
  const retryable = results.filter((r) => r.disposition === 'RETRY_BACKOFF');
  const terminal = results.filter(
    (r) => r.disposition && NON_TRANSIENT.includes(r.disposition as Disposition),
  );
  return { retryable, terminal };
}

interface ChunkOutcome {
  results: DeliveryResult[];
  /** Credential id used for this send — needed to invalidate the token cache on REAUTH. */
  credentialId: string | null;
}

async function processSendChunk(job: typeof jobs.$inferSelect): Promise<ChunkOutcome> {
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
  if (rows.length === 0) return { results: [], credentialId: null };

  const resolved = await resolveCredential(camp.appId, payload.provider, payload.platform);
  if (!resolved.ready) {
    await recordCredentialNotReady(payload.campaignId, rows);
    return { results: [], credentialId: null };
  }

  const adapter = getAdapter(payload.provider);
  const neutral = toNeutral(camp);
  validatePayloadSize(neutral, payload.provider);
  await getAccessToken(resolved.credential, (c) => adapter.mintToken(c));
  const wire = adapter.render(neutral);
  const recipients: Recipient[] = rows.map((d) => ({
    deviceId: d.id,
    token: d.token,
    platform: d.platform,
  }));
  const results: DeliveryResult[] = await adapter.send(resolved.credential, wire, recipients);
  await writeResults(payload.campaignId, rows, results);
  return { results, credentialId: resolved.credential.id };
}

export async function runWorkerOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  const payload = job.payloadJsonb as SendChunkPayload;
  try {
    const { results, credentialId } = await processSendChunk(job);
    const { retryable, terminal } = classify(results);

    // Non-transient disposition: fail the job terminally, never retry.
    // (sent/invalid/DELETE_TOKEN rows already persisted by writeResults.)
    if (terminal.length > 0) {
      // REAUTH means the OAuth token cached for this credential is stale. Evict it from the
      // in-memory cache so the next job for the same credential re-mints immediately rather
      // than waiting up to ~1h for the TTL to expire naturally.
      const hasReauth = terminal.some((r) => r.disposition === 'REAUTH');
      if (hasReauth && credentialId) {
        invalidateToken(credentialId);
      }
      // Dead-letter any retryable tokens that were in the same batch: when terminal wins the
      // job will never be retried, so these tokens need a gave_up row or they have no record.
      if (retryable.length > 0) {
        await db.insert(deliveries).values(
          retryable.map((r) => ({
            campaignId: payload.campaignId,
            deviceId: r.deviceId ?? null,
            provider: payload.provider as typeof deliveries.$inferInsert['provider'],
            platform: payload.platform as typeof deliveries.$inferInsert['platform'],
            token: r.token,
            status: 'gave_up' as const,
            disposition: r.disposition ?? 'RETRY_BACKOFF',
            errorCode: r.errorCode ?? null,
            responseMeta: r.responseMeta ?? null,
            sentAt: null,
          })),
        );
      }
      await db
        .update(jobs)
        .set({
          status: 'failed',
          attempts: job.attempts + 1,
          lastError: `non-transient: ${terminal[0].disposition}`,
        })
        .where(eq(jobs.id, job.id));
      return true;
    }

    // No retryable results: job is fully done.
    if (retryable.length === 0) {
      await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id));
      return true;
    }

    // Retryable path: check if we've exhausted attempts.
    const nextAttempts = job.attempts + 1;

    // Reserved Retry-After hook: no adapter populates responseMeta.retryAfterMs today
    // (the M5 FcmAdapter does not yet read the HTTP Retry-After header), so this is
    // effectively `undefined` and nextRunAfter falls back to pure exponential backoff.
    // Wire the adapter to set responseMeta.retryAfterMs to honor Retry-After end-to-end.
    const retryAfterMs = retryable[0].responseMeta?.retryAfterMs as number | undefined;

    if (nextAttempts >= job.maxAttempts) {
      // Retry ceiling reached: dead-letter the remaining tokens.
      await db
        .update(jobs)
        .set({
          status: 'failed',
          attempts: nextAttempts,
          lastError: 'retry ceiling reached',
        })
        .where(eq(jobs.id, job.id));
      await db.insert(deliveries).values(
        retryable.map((r) => ({
          campaignId: payload.campaignId,
          deviceId: r.deviceId ?? null,
          provider: payload.provider as typeof deliveries.$inferInsert['provider'],
          platform: payload.platform as typeof deliveries.$inferInsert['platform'],
          token: r.token,
          status: 'gave_up' as const,
          disposition: r.disposition ?? 'RETRY_BACKOFF',
          errorCode: r.errorCode ?? null,
          responseMeta: r.responseMeta ?? null,
          sentAt: null,
        })),
      );
      return true;
    }

    // Requeue with only the still-failing recipients and a backed-off run_after.
    const retryDeviceIds = retryable.map((r) => r.deviceId).filter((x): x is string => !!x);
    const newPayload: SendChunkPayload = { ...payload, deviceIds: retryDeviceIds };
    await db
      .update(jobs)
      .set({
        status: 'pending',
        attempts: nextAttempts,
        runAfter: nextRunAfter(nextAttempts, retryAfterMs),
        claimedAt: null,
        payloadJsonb: newPayload,
      })
      .where(eq(jobs.id, job.id));
    return true;
  } catch (err) {
    const nextAttempts = job.attempts + 1;
    const errMsg = String((err as Error)?.message ?? err);
    // Terminal exceptions (e.g. payload too large) — fail immediately, no retry.
    const isTerminal = err instanceof PayloadTooLargeError;
    if (isTerminal || nextAttempts >= job.maxAttempts) {
      await db
        .update(jobs)
        .set({
          status: 'failed',
          attempts: nextAttempts,
          lastError: errMsg,
        })
        .where(eq(jobs.id, job.id));
    } else {
      await db
        .update(jobs)
        .set({
          status: 'pending',
          attempts: nextAttempts,
          runAfter: nextRunAfter(nextAttempts),
          claimedAt: null,
          lastError: errMsg,
        })
        .where(eq(jobs.id, job.id));
    }
    return true;
  }
}
