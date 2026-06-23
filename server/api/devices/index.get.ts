/**
 * GET /api/devices?appId=&platform=&provider=&tag=&q=&limit=&cursor=
 *
 * Operator-authed device listing with:
 * - optional filters: appId, platform, provider, tag, q (token or externalUserId substring)
 * - keyset pagination on (created_at DESC, id DESC) via limit + cursor
 * - masked tokens in response: first6...last6
 *
 * Cursor: base64url-encoded JSON { epochMicros: string, id: string }.
 * Epoch microseconds stored as a string (bigint) to preserve PostgreSQL microsecond precision
 * without going through a JS Date (which only has millisecond precision).
 */
import { getQuery, defineEventHandler } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { and, eq, or, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

const QuerySchema = z.object({
  appId: z.string().uuid().optional(),
  platform: z.enum(['android', 'ios', 'huawei', 'web']).optional(),
  provider: z.enum(['fcm', 'huawei']).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

function maskToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-6)}`;
}

export default defineEventHandler(async (event) => {
  await requireUser(event);

  const raw = getQuery(event);
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    const { createError } = await import('h3');
    throw createError({ statusCode: 422, statusMessage: 'Invalid query parameters' });
  }

  const { appId, platform, provider, tag, q, limit, cursor } = parsed.data;

  const filters: SQL[] = [];

  if (appId) filters.push(eq(devices.appId, appId));
  if (platform) filters.push(eq(devices.platform, platform));
  if (provider) filters.push(eq(devices.provider, provider));
  if (tag) filters.push(sql`${tag} = ANY(${devices.tags})`);
  if (q) {
    const pattern = `%${q}%`;
    filters.push(or(
      ilike(devices.token, pattern),
      ilike(devices.externalUserId, pattern),
    ) as SQL);
  }

  // Cursor: { epochMicros: string (bigint), id: UUID }
  // Uses epoch microseconds to avoid JS Date millisecond-precision vs PG microsecond mismatch.
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        epochMicros: string;
        id: string;
      };
      const { epochMicros, id: cursorId } = decoded;
      // (created_at DESC, id DESC) keyset — next page:
      //   epoch_us < cursor_epoch OR (epoch_us = cursor_epoch AND id < cursor_id)
      filters.push(sql`(
        (extract(epoch from ${devices.createdAt}) * 1000000)::bigint < ${epochMicros}::bigint
        OR (
          (extract(epoch from ${devices.createdAt}) * 1000000)::bigint = ${epochMicros}::bigint
          AND ${devices.id} < ${cursorId}::uuid
        )
      )`);
    } catch {
      const { createError } = await import('h3');
      throw createError({ statusCode: 422, statusMessage: 'Invalid cursor' });
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  type DeviceRow = typeof devices.$inferSelect & { _epochMicros: string };

  // SELECT all device columns + epoch microseconds for the cursor (avoids a second DB round-trip)
  const rows = await db
    .select({
      id: devices.id,
      appId: devices.appId,
      provider: devices.provider,
      platform: devices.platform,
      token: devices.token,
      externalUserId: devices.externalUserId,
      tags: devices.tags,
      attributesJsonb: devices.attributesJsonb,
      status: devices.status,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
      _epochMicros: sql<string>`((extract(epoch from ${devices.createdAt}) * 1000000)::bigint)::text`,
    })
    .from(devices)
    .where(where)
    .orderBy(sql`${devices.createdAt} DESC, ${devices.id} DESC`)
    .limit(limit + 1) as DeviceRow[];

  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;

  let nextCursor: string | undefined;
  if (hasNext && page.length > 0) {
    const last = page[page.length - 1]!;
    nextCursor = Buffer.from(JSON.stringify({
      epochMicros: last._epochMicros,
      id: last.id,
    })).toString('base64url');
  }

  return {
    devices: page.map(({ _epochMicros: _, ...d }) => ({
      ...d,
      token: maskToken(d.token),
    })),
    ...(nextCursor ? { nextCursor } : {}),
  };
});
