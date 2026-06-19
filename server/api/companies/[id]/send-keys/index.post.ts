import { createError, getRouterParam, readBody, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { issueSendKey } from '~~/server/utils/send-keys';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  assertCsrf(event);
  const companyId = getRouterParam(event, 'id')!;

  // 404 if the company does not exist.
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw createError({ statusCode: 404, statusMessage: 'company not found' });

  const body = await readBody<{ label?: string }>(event).catch(() => ({}));
  const issued = await issueSendKey(db, companyId, user.id, body?.label);
  await audit({
    userId: user.id,
    action: 'send_key_issue',
    targetType: 'company',
    targetId: companyId,
    meta: { sendKeyId: issued.id, version: issued.version },
  });

  // fullKey is returned ONCE here and never again.
  return { id: issued.id, fullKey: issued.fullKey, keyPrefix: issued.keyPrefix, version: issued.version };
});
