import { createError, getRouterParam, setResponseStatus, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { companies } from '~~/server/db/schema';
import { revokeSendKey } from '~~/server/utils/send-keys';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  assertCsrf(event);
  const companyId = getRouterParam(event, 'id')!;
  const kid = getRouterParam(event, 'kid')!;

  // 404 if the company does not exist.
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw createError({ statusCode: 404, statusMessage: 'company not found' });

  await revokeSendKey(db, companyId, kid);
  await audit({
    userId: user.id,
    action: 'send_key_revoke',
    targetType: 'company',
    targetId: companyId,
    meta: { sendKeyId: kid },
  });

  setResponseStatus(event, 204);
  return null;
});
