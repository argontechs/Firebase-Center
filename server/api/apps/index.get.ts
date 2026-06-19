import { eq, desc } from 'drizzle-orm';
import { createError, getQuery, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { apps } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  await requireSession(event);
  const companyId = String(getQuery(event).companyId ?? '');
  if (!UUID_RE.test(companyId)) throw createError({ statusCode: 422, statusMessage: 'companyId query param required' });
  return db.select().from(apps).where(eq(apps.companyId, companyId)).orderBy(desc(apps.createdAt));
});
