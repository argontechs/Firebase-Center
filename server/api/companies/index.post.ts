import { readBody, setResponseStatus, createError, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { parseCompanyCreate } from '~~/server/utils/validation/company';
import { isUniqueViolation } from '~~/server/utils/db-errors';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  // CSRF is enforced by the global middleware (server/middleware/auth.ts) for all state-changing routes.
  const input = parseCompanyCreate(await readBody(event));
  try {
    const [row] = await db.insert(companies).values(input).returning();
    setResponseStatus(event, 201);
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'A company with that name already exists' });
    }
    throw err;
  }
});
