import { desc } from 'drizzle-orm';
import { defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { apps } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

/**
 * GET /api/apps/all
 *
 * Returns a flat cross-company list of all apps the signed-in operator can
 * see.  Used by the Send page app-select (single-app and broadcast modes)
 * where there is no single companyId context.
 *
 * Session-guarded; no CSRF needed (read-only).
 */
export default defineEventHandler(async (event) => {
  await requireSession(event);
  return db.select().from(apps).orderBy(desc(apps.createdAt));
});
