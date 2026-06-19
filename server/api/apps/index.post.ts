import { eq } from 'drizzle-orm';
import { readBody, createError, setResponseStatus, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { apps, companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { parseAppCreate } from '~~/server/utils/validation/app';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  // CSRF is enforced by the global middleware (server/middleware/auth.ts) for all state-changing routes.
  const input = parseAppCreate(await readBody(event));
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw createError({ statusCode: 404, statusMessage: 'company not found' });
  const [row] = await db.insert(apps).values(input).returning();
  setResponseStatus(event, 201);
  return row;
});
