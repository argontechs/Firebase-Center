import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { listCredentials } from '~~/server/utils/credentials/list';

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const appId = getRouterParam(event, 'id')!;
  return await listCredentials(appId);
});
