import { desc } from 'drizzle-orm';
import { defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';

export default defineEventHandler(async (event) => {
  await requireSession(event);
  return db.select().from(companies).orderBy(desc(companies.createdAt));
});
