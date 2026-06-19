import { eq } from 'drizzle-orm';
import { readBody, createError, getRouterParam, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { apps } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { parseAppPatch } from '~~/server/utils/validation/app';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  // CSRF is enforced by the global middleware (server/middleware/auth.ts) for all state-changing routes.
  const id = getRouterParam(event, 'id')!;
  const patch = parseAppPatch(await readBody(event));
  const [row] = await db.update(apps).set(patch).where(eq(apps.id, id)).returning();
  if (!row) throw createError({ statusCode: 404, statusMessage: 'app not found' });
  return row;
});
