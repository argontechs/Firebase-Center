import { eq } from 'drizzle-orm';
import { createError, getRouterParam, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  const id = getRouterParam(event, 'id')!;
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  if (!row) throw createError({ statusCode: 404, statusMessage: 'company not found' });
  return row;
});
