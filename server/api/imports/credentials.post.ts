import { createError, readMultipartFormData, defineEventHandler } from 'h3';
import { requireUser } from '~~/server/utils/auth/guard';
import { assertCsrf } from '~~/server/utils/auth/guard';
import { importCredentials } from '~~/server/utils/import/credentials';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);   // throws 401 if absent; admin or operator
  assertCsrf(event);                          // throws 403 on bad/missing token

  const parts = await readMultipartFormData(event);
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'multipart body required' });

  const manifestPart = parts.find((p) => p.name === 'manifest');
  if (!manifestPart?.data) throw createError({ statusCode: 400, statusMessage: 'manifest CSV is required' });

  // Every non-manifest part is an uploaded .json keyed by its part name (the sa_json_file filename).
  const files: Record<string, string> = {};
  for (const p of parts) {
    if (p.name && p.name !== 'manifest' && p.data) files[p.name] = p.data.toString('utf-8');
  }

  return await importCredentials({
    userId: session.id,
    manifestCsv: manifestPart.data.toString('utf-8'),
    files,
  });
});
