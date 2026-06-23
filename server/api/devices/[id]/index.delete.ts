/**
 * DELETE /api/devices/:id
 *
 * Operator device delete — removes a device record entirely.
 *
 * Auth: requireSession
 * Errors:
 *   404 — device not found
 */
import { getRouterParam, createError, setResponseStatus, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { devices } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const id = getRouterParam(event, 'id')!;

  const [row] = await db.delete(devices)
    .where(eq(devices.id, id))
    .returning();

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Device not found' });

  await audit({
    userId: session.userId,
    action: 'device_delete',
    targetType: 'device',
    targetId: row.id,
    meta: { appId: row.appId },
  });

  setResponseStatus(event, 204);
  return null;
});
