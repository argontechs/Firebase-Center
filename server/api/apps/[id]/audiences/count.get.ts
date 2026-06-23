import { getQuery, getRouterParam, defineEventHandler } from 'h3';
import { requireSession } from '~~/server/utils/auth/guard';
import { countAudience, type AudienceFilter } from '~~/server/utils/audiences/resolve';

/**
 * GET /api/apps/:id/audiences/count?platform=&provider=&tag=
 *
 * Returns the number of active devices matching the given filter for this app.
 * Used by the Audiences UI for live count previews while composing a filter.
 */
export default defineEventHandler(async (event) => {
  await requireSession(event);
  const appId = getRouterParam(event, 'id')!;
  const query = getQuery(event);

  const filter: AudienceFilter = {};
  if (query.platform) filter.platform = query.platform as AudienceFilter['platform'];
  if (query.provider) filter.provider = query.provider as AudienceFilter['provider'];
  if (query.tag) filter.tag = String(query.tag);

  const count = await countAudience(appId, filter);
  return { count };
});
