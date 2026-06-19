import { createError, getRequestIP, getRouterParam, readBody, setResponseStatus, defineEventHandler } from 'h3';
import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { authenticateIngest } from '~~/server/utils/ingest-auth';
import { validateRows } from '~~/server/utils/import/validate';
import { upsertDevices } from '~~/server/utils/import/upsert';
import { rateLimit } from '~~/server/utils/rate-limit';

// Per-key / per-IP sliding-window limit.
// Read at request time (not module-load time) so that INGEST_RATE_LIMIT set
// before the first import in tests is honoured even if this module was cached
// by a prior test run in the same Vitest worker.
const WINDOW_MS = 60_000;
function ingestLimit(): number {
  return Number(process.env.INGEST_RATE_LIMIT ?? 600);
}

export default defineEventHandler(async (event) => {
  const appId = getRouterParam(event, 'id')!;

  // Bearer-key auth: 401 for missing/invalid key, 403 for wrong-app key.
  const ctx = await authenticateIngest(event, appId);

  // Per-key sliding-window rate limit (limit read at request time so test env
  // overrides via INGEST_RATE_LIMIT take effect even with a cached module).
  const limit = ingestLimit();
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';
  rateLimit(`ingest:key:${ctx.keyId}`, limit, WINDOW_MS);
  rateLimit(`ingest:ip:${ip}`, limit, WINDOW_MS);

  const raw = await readBody<Record<string, unknown>>(event);

  // Strict field whitelist — only these four are read from the body.
  // `appId` always comes from the route param; body `appId` is ignored.
  const parsed = {
    rowNumber: 1,
    token: typeof raw?.token === 'string' ? raw.token.trim() || null : null,
    provider: typeof raw?.provider === 'string' ? raw.provider : null,
    platform: typeof raw?.platform === 'string' ? raw.platform : null,
    externalUserId: typeof raw?.external_user_id === 'string' ? raw.external_user_id : null,
    attributes: {} as Record<string, string>,
  };

  const { valid, rejected } = validateRows([parsed]);
  if (rejected.length > 0) {
    throw createError({ statusCode: 422, statusMessage: `unroutable: ${rejected[0].reason}` });
  }

  await upsertDevices(db, appId, valid);   // route appId wins; body appId ignored

  const [d] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.appId, appId), eq(devices.token, valid[0].token)));

  setResponseStatus(event, 201);
  return { id: d!.id };
});
