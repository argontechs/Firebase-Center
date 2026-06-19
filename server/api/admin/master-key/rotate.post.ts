import { defineEventHandler } from 'h3';
import { requireAdmin } from '~~/server/utils/auth/require-admin';
import { assertCsrf } from '~~/server/utils/auth/guard';
import { rotateMasterKey } from '~~/server/utils/credentials/rotate-master-key';

export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event);
  assertCsrf(event);
  return await rotateMasterKey({ userId: user.id });
});
