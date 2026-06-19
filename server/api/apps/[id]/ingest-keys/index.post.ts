import { getRouterParam, readBody, defineEventHandler } from 'h3';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { issueIngestKey } from '~~/server/utils/ingest-keys';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  assertCsrf(event);
  const appId = getRouterParam(event, 'id')!;
  const body = await readBody<{ label?: string }>(event).catch(() => ({}));
  const issued = await issueIngestKey(db, appId, user.id, body?.label);
  await audit({
    userId: user.id, action: 'ingest_key_issue', targetType: 'app', targetId: appId,
    meta: { ingestKeyId: issued.id, version: issued.version },
  });
  return { key: issued.fullKey, id: issued.id, prefix: issued.keyPrefix, version: issued.version };
});
