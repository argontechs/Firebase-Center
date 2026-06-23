/**
 * PATCH /api/devices/:id
 *
 * Operator tag edit — sets the tags array on a device.
 *
 * Scope check: mirrors DELETE. The device's app must belong to an active company.
 *
 * Body: { tags: string[] }
 * Auth: requireSession
 * Errors:
 *   422 — validation failure
 *   404 — device not found (or its company is not visible)
 */
import { readBody, getRouterParam, createError, defineEventHandler } from 'h3';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '~~/server/db/client';
import { devices, apps, companies } from '~~/server/db/schema';
import { requireSession } from '~~/server/utils/auth/guard';
import { audit } from '~~/server/utils/audit';

const bodySchema = z.object({
  tags: z.array(z.string()),
});

export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const id = getRouterParam(event, 'id')!;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const { tags } = parsed.data;

  // Scope check: resolve the device together with its app's company visibility.
  // Under flat-RBAC all active companies are visible to every operator.
  const [scoped] = await db
    .select({ deviceId: devices.id, companyStatus: companies.status })
    .from(devices)
    .innerJoin(apps, eq(apps.id, devices.appId))
    .innerJoin(companies, eq(companies.id, apps.companyId))
    .where(eq(devices.id, id));

  if (!scoped || scoped.companyStatus !== 'active') {
    throw createError({ statusCode: 404, statusMessage: 'Device not found' });
  }

  const [row] = await db.update(devices)
    .set({ tags })
    .where(eq(devices.id, id))
    .returning();

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Device not found' });

  await audit({
    userId: session.userId,
    action: 'device_edit_tags',
    targetType: 'device',
    targetId: row.id,
    meta: { tags },
  });

  return row;
});
