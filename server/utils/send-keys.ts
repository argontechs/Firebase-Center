import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { createError } from 'h3';   // util may throw 404 on rotate/revoke; import explicitly (not auto-imported in util context)
import { siteSendKeys } from '~~/server/db/schema';

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

export function generateSendKey(): GeneratedKey {
  // 24 random bytes → 32-char base64url → well over the 32-char minimum in tests
  const fullKey = 'bo_sk_' + randomBytes(24).toString('base64url');
  const keyHash = hashKey(fullKey);
  // 'bo_sk_' (6) + 6 more chars = 12 chars — a human-readable display prefix
  const keyPrefix = fullKey.slice(0, 12);
  return { fullKey, keyHash, keyPrefix };
}

/**
 * Constant-time compare of a presented key against a stored SHA-256 hash.
 * Returns false immediately if the hash lengths mismatch (wrong-length keys
 * cannot pass the timing-safe comparison anyway).
 */
export function verifySendKey(fullKey: string, keyHash: string): boolean {
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
 * Mint and store a new send key for `companyId`.
 * Returns the row id, the one-time plaintext key, the display prefix, and the
 * version number.  The raw key is NEVER stored — only the SHA-256 hash is.
 */
export async function issueSendKey(
  db: DrizzleDb,
  companyId: string,
  userId: string | null,
  label?: string,
): Promise<{ id: string; fullKey: string; keyPrefix: string; version: number }> {
  const { fullKey, keyHash, keyPrefix } = generateSendKey();
  const [row] = await db
    .insert(siteSendKeys)
    .values({ companyId, keyHash, keyPrefix, version: 1, label, createdBy: userId })
    .returning();
  return { id: row.id, fullKey, keyPrefix, version: row.version };
}

/**
 * Rotate an existing send key: revoke the old one and mint a successor with version+1.
 * Throws 404 if the key is not found for the given company.
 */
export async function rotateSendKey(
  db: DrizzleDb,
  companyId: string,
  keyId: string,
  userId: string | null,
): Promise<{ id: string; fullKey: string; keyPrefix: string; version: number }> {
  const [old] = await db
    .select()
    .from(siteSendKeys)
    .where(and(eq(siteSendKeys.id, keyId), eq(siteSendKeys.companyId, companyId)));
  if (!old) throw createError({ statusCode: 404, statusMessage: 'send key not found' });

  // Revoke the old key
  await db
    .update(siteSendKeys)
    .set({ revokedAt: new Date() })
    .where(eq(siteSendKeys.id, keyId));

  // Issue a successor with version+1
  const { fullKey, keyHash, keyPrefix } = generateSendKey();
  const [row] = await db
    .insert(siteSendKeys)
    .values({
      companyId,
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
 * Mark a send key as revoked (idempotency guard: only revokes active keys).
 * Throws 404 if not found or already revoked.
 */
export async function revokeSendKey(
  db: DrizzleDb,
  companyId: string,
  keyId: string,
): Promise<void> {
  const res = await db
    .update(siteSendKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(siteSendKeys.id, keyId),
        eq(siteSendKeys.companyId, companyId),
        isNull(siteSendKeys.revokedAt),
      ),
    )
    .returning({ id: siteSendKeys.id });

  if (res.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'send key not found' });
  }
}

/**
 * Look up which company a presented bearer key belongs to, but only when the key
 * is still active (not revoked).  Returns null for unknown or revoked keys.
 */
export async function resolveActiveSendKey(
  db: DrizzleDb,
  fullKey: string,
): Promise<{ id: string; companyId: string } | null> {
  const keyHash = hashKey(fullKey);
  const [row] = await db
    .select({ id: siteSendKeys.id, companyId: siteSendKeys.companyId })
    .from(siteSendKeys)
    .where(and(eq(siteSendKeys.keyHash, keyHash), isNull(siteSendKeys.revokedAt)));
  return row ?? null;
}
