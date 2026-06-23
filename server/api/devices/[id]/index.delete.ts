/**
 * DELETE /api/devices/:id
 *
 * Operator device delete — removes a device record entirely.
 *
 * Scope check: the device's app must belong to a visible (active) company.
 * Under the current flat-RBAC model all operators can see all active companies,
 * so the check is: device → apps → companies WHERE status = 'active'.
 *
 * Auth: requireSession
 * Errors:
 *   404 — device not found (or its company is not visible)
 */
import { getRouterParam, createError, setResponseStatus, defineEventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db/client';
import { devices, apps, companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const id = getRouterParam(event, 'id')!;

  // Scope check: resolve the device together with its app's company visibility.
  // Under flat-RBAC all active companies are visible to every operator.
  const [scoped] = await db
    .select({ deviceId: devices.id, appId: devices.appId, companyStatus: companies.status })
    .from(devices)
    .innerJoin(apps, eq(apps.id, devices.appId))
    .innerJoin(companies, eq(companies.id, apps.companyId))
    .where(eq(devices.id, id));

  if (!scoped || scoped.companyStatus !== 'active') {
    throw createError({ statusCode: 404, statusMessage: 'Device not found' });
  }

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
