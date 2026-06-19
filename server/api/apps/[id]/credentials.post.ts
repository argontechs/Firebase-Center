import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { saveCredential } from '~~/server/utils/credentials/save';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  assertCsrf(event);
  const appId = getRouterParam(event, 'id')!;
  const body = await readBody<{
    provider: 'fcm' | 'huawei';
    platform: 'ios' | 'android' | 'huawei' | 'web' | 'any';
    label?: string;
    secret: string;
    meta?: Record<string, unknown>;
  }>(event);

  try {
    return await saveCredential({
      appId, userId: session.id,
      provider: body.provider, platform: body.platform,
      label: body.label, secret: body.secret, meta: body.meta,
    });
  } catch (err: any) {
    if (/duplicate key|unique/i.test(String(err?.message))) {
      throw createError({ statusCode: 409, statusMessage: 'Credential already exists for this provider/platform' });
    }
    if (/invalid (provider|platform)|secret is required/i.test(String(err?.message))) {
      throw createError({ statusCode: 400, statusMessage: err.message });
    }
    throw err;
  }
});
