import { createError, getRouterParam, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { requireUser } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { companies, siteSendKeys } from '~~/server/db/schema';

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const companyId = getRouterParam(event, 'id')!;

  // 404 if the company does not exist.
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw createError({ statusCode: 404, statusMessage: 'company not found' });

  // Return metadata only — never fullKey / keyHash.
  return db
    .select({
      id: siteSendKeys.id,
      keyPrefix: siteSendKeys.keyPrefix,
      version: siteSendKeys.version,
      label: siteSendKeys.label,
      createdAt: siteSendKeys.createdAt,
      revokedAt: siteSendKeys.revokedAt,
    })
    .from(siteSendKeys)
    .where(eq(siteSendKeys.companyId, companyId));
});
