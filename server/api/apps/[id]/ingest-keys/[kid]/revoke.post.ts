import { getRouterParam, setResponseStatus, defineEventHandler } from 'h3';
import { requireUser, assertCsrf } from '~~/server/utils/auth/guard';
import { db } from '~~/server/db/client';
import { revokeIngestKey } from '~~/server/utils/ingest-keys';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  assertCsrf(event);
  const appId = getRouterParam(event, 'id')!;
  const kid = getRouterParam(event, 'kid')!;
  await revokeIngestKey(db, appId, kid);
  await audit({
    userId: user.id, action: 'ingest_key_revoke', targetType: 'app', targetId: appId,
    meta: { ingestKeyId: kid },
  });
  setResponseStatus(event, 204);
  return null;
});
