import { eq } from 'drizzle-orm';
import { createError, getRouterParam, setResponseStatus, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { isFkViolation } from '~~/server/utils/db-errors';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  // CSRF is enforced by the global middleware (server/middleware/auth.ts) for all state-changing routes.
  const id = getRouterParam(event, 'id')!;
  try {
    const deleted = await db.delete(companies).where(eq(companies.id, id)).returning({ id: companies.id });
    if (deleted.length === 0) throw createError({ statusCode: 404, statusMessage: 'company not found' });
    setResponseStatus(event, 204);
    return null;
  } catch (err: any) {
    if (err?.statusCode) throw err;
    if (isFkViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'Cannot delete company: child records exist (apps or send-keys)' });
    }
    throw err;
  }
});
