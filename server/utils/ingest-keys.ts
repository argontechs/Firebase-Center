import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { createError } from 'h3';   // util may throw 404 on rotate/revoke; import explicitly (not auto-imported in util context)
import { appIngestKeys } from '~~/server/db/schema';

// ---- Types ----

export interface GeneratedKey {
  fullKey: string;
  keyHash: string;
  keyPrefix: string;
}

// DrizzleDb: a minimal interface that matches both the singleton `db` from client.ts
// and any test-created db instance. Using `any` here avoids a circular dependency on
// a test helper; callers supply a properly-typed Drizzle instance.
type DrizzleDb = ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>;

// ---- Pure crypto helpers ----

function hashKey(fullKey: string): string {
  return createHash('sha256').update(fullKey).digest('hex');
}

export function generateIngestKey(): GeneratedKey {
  // 24 random bytes → 32-char base64url → well over the 32-char minimum in tests
  const fullKey = 'bo_ik_' + randomBytes(24).toString('base64url');
  const keyHash = hashKey(fullKey);
  // 'bo_ik_' (6) + 6 more chars = 12 chars — a human-readable display prefix
  const keyPrefix = fullKey.slice(0, 12);
  return { fullKey, keyHash, keyPrefix };
}

/**
 * Constant-time compare of a presented key against a stored SHA-256 hash.
 * Returns false immediately if the hash lengths mismatch (wrong-length keys
 * cannot pass the timing-safe comparison anyway).
 */
export function verifyIngestKey(fullKey: string, keyHash: string): boolean {
  const a = Buffer.from(hashKey(fullKey), 'hex');
  try {
    const b = Buffer.from(keyHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  catch {
    return false;
  }
}

// ---- DB operations ----

/**
 * Mint and store a new ingest key for `appId`.
 * Returns the row id, the one-time plaintext key, the display prefix, and the
 * version number.  The raw key is NEVER stored — only the SHA-256 hash is.
 */
export async function issueIngestKey(
  db: DrizzleDb,
  appId: string,
  userId: string | null,
  label?: string,
): Promise<{ id: string; fullKey: string; keyPrefix: string; version: number }> {
  const { fullKey, keyHash, keyPrefix } = generateIngestKey();
  const [row] = await db
    .insert(appIngestKeys)
    .values({ appId, keyHash, keyPrefix, version: 1, label, createdBy: userId })
    .returning();
  return { id: row.id, fullKey, keyPrefix, version: row.version };
}

/**
 * Rotate an existing key: revoke the old one and mint a successor with version+1.
 * Throws 404 if the key is not found for the given app.
 */
export async function rotateIngestKey(
  db: DrizzleDb,
  appId: string,
  keyId: string,
  userId: string | null,
): Promise<{ id: string; fullKey: string; keyPrefix: string; version: number }> {
  const [old] = await db
    .select()
    .from(appIngestKeys)
    .where(and(eq(appIngestKeys.id, keyId), eq(appIngestKeys.appId, appId)));
  if (!old) throw createError({ statusCode: 404, statusMessage: 'ingest key not found' });

  // Revoke the old key
  await db
    .update(appIngestKeys)
    .set({ revokedAt: new Date() })
    .where(eq(appIngestKeys.id, keyId));

  // Issue a successor with version+1
  const { fullKey, keyHash, keyPrefix } = generateIngestKey();
  const [row] = await db
    .insert(appIngestKeys)
    .values({
      appId,
      keyHash,
      keyPrefix,
      version: old.version + 1,
      label: old.label,
      createdBy: userId,
    })
    .returning();

  return { id: row.id, fullKey, keyPrefix, version: row.version };
}

/**
 * Mark an ingest key as revoked (idempotency guard: only revokes active keys).
 * Throws 404 if not found or already revoked.
 */
export async function revokeIngestKey(
  db: DrizzleDb,
  appId: string,
  keyId: string,
): Promise<void> {
  const res = await db
    .update(appIngestKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(appIngestKeys.id, keyId),
        eq(appIngestKeys.appId, appId),
        isNull(appIngestKeys.revokedAt),
      ),
    )
    .returning({ id: appIngestKeys.id });

  if (res.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'ingest key not found' });
  }
}

/**
 * Look up which app a presented bearer key belongs to, but only when the key
 * is still active (not revoked).  Returns null for unknown or revoked keys.
 */
export async function resolveActiveKey(
  db: DrizzleDb,
  fullKey: string,
): Promise<{ id: string; appId: string } | null> {
  const keyHash = hashKey(fullKey);
  const [row] = await db
    .select({ id: appIngestKeys.id, appId: appIngestKeys.appId })
    .from(appIngestKeys)
    .where(and(eq(appIngestKeys.keyHash, keyHash), isNull(appIngestKeys.revokedAt)));
  return row ?? null;
}
