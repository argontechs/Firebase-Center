import { createError, getHeader, type H3Event } from 'h3';
import { db } from '~~/server/db/client';
import { resolveActiveKey } from '~~/server/utils/ingest-keys';

export interface IngestContext { keyId: string; appId: string; }

/**
 * Reads `Authorization: Bearer <key>`, resolves it against the DB, and
 * asserts that it is bound to `routeAppId`.
 *
 * Throws:
 *  401  — missing/malformed header, or key not found / revoked
 *  403  — key exists but belongs to a different app
 */
export async function authenticateIngest(event: H3Event, routeAppId: string): Promise<IngestContext> {
  const header = getHeader(event, 'authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw createError({ statusCode: 401, statusMessage: 'missing bearer key' });

  const resolved = await resolveActiveKey(db, match[1]);
  if (!resolved) throw createError({ statusCode: 401, statusMessage: 'invalid ingest key' });

  if (resolved.appId !== routeAppId) {
    throw createError({ statusCode: 403, statusMessage: 'key not bound to this app' });
  }

  return { keyId: resolved.id, appId: resolved.appId };
}
