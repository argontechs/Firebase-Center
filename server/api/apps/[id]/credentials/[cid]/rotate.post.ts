import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { rotateCredential } from '~~/server/utils/credentials/rotate';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  assertCsrf(event);
  const appId = getRouterParam(event, 'id')!;
  const cid = getRouterParam(event, 'cid')!;
  const body = await readBody<{ secret: string; meta?: Record<string, unknown> }>(event);
  try {
    return await rotateCredential({ appId, credentialId: cid, userId: session.id, secret: body?.secret, meta: body?.meta });
  } catch (err: any) {
    if (/not found/i.test(String(err?.message))) throw createError({ statusCode: 404, statusMessage: 'Credential not found' });
    if (/secret is required/i.test(String(err?.message))) throw createError({ statusCode: 400, statusMessage: err.message });
    throw err;
  }
});
