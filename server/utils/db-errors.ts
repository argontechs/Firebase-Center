/**
 * Postgres error-code helpers for route-level error mapping.
 *
 * These intentionally do NOT depend on any specific driver class —
 * they inspect the plain `code` property and message string so they
 * work with pg, postgres.js, or any wrapper that forwards the raw
 * Postgres error code.
 */

/**
 * Returns true when `err` is a Postgres UNIQUE-VIOLATION (23505)
 * or any error whose message looks like a duplicate-key/unique failure.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === '23505') return true;
  if (typeof e['message'] === 'string' && /duplicate key|unique/i.test(e['message'])) return true;
  return false;
}

/**
 * Returns true when `err` is a Postgres FOREIGN-KEY-VIOLATION (23503),
 * indicating that a child row still references the row being deleted.
 */
export function isFkViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === '23503') return true;
  if (typeof e['message'] === 'string' && /foreign key|violates foreign|fk/i.test(e['message'])) return true;
  return false;
}
