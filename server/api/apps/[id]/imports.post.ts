import { createError, getRouterParam, readMultipartFormData, defineEventHandler } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { runImport } from '~~/server/utils/import/run';
import type { ImportFormat } from '~~/server/utils/import/parse';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);   // throws 401 if absent
  assertCsrf(event);                       // throws 403 on bad/missing token
  const appId = getRouterParam(event, 'id')!;

  const parts = await readMultipartFormData(event);
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'multipart body required' });

  const filePart = parts.find((p) => p.name === 'file');
  if (!filePart?.data) throw createError({ statusCode: 400, statusMessage: 'file is required' });

  const field = (n: string) => parts.find((p) => p.name === n)?.data?.toString('utf-8');
  const format = (field('format') ?? 'csv') as ImportFormat;
  const mapping = JSON.parse(field('mapping') ?? '{}');
  const defaults = {
    provider: field('defaultProvider') || undefined,
    platform: field('defaultPlatform') || undefined,
  };

  const result = await runImport({
    db,
    appId,
    userId: user.id,
    filename: filePart.filename ?? 'upload',
    raw: filePart.data.toString('utf-8'),
    format,
    mapping,
    defaults,
  });
  return result;
});
