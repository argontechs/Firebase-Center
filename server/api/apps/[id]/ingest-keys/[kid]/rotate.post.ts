import { getRouterParam, defineEventHandler } from 'h3';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { rotateIngestKey } from '~~/server/utils/ingest-keys';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  assertCsrf(event);
  const appId = getRouterParam(event, 'id')!;
  const kid = getRouterParam(event, 'kid')!;
  const rotated = await rotateIngestKey(db, appId, kid, user.id);
  // Taxonomy has only ingest_key_issue / ingest_key_revoke — rotate is recorded as an issue
  await audit({
    userId: user.id, action: 'ingest_key_issue', targetType: 'app', targetId: appId,
    meta: { ingestKeyId: rotated.id, version: rotated.version, rotatedFrom: kid },
  });
  return { key: rotated.fullKey, id: rotated.id, prefix: rotated.keyPrefix, version: rotated.version };
});
