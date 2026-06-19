import { eq, and, ne, count } from 'drizzle-orm';
import { getRouterParam, setResponseStatus, createError, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { requireAdmin } from '~~/server/utils/auth/require-admin';
import { destroyAllSessionsForUser } from '~~/server/utils/auth/session';
import { audit } from '~~/server/utils/audit';

export default defineEventHandler(async (event) => {
  const actor = await requireAdmin(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing id' });

  // Last-admin lockout guard: reject if this would leave zero active admins.
  const [targetRow] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
  if (targetRow?.role === 'admin') {
    const [{ value: activeAdminCount }] = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, id)));
    if (activeAdminCount === 0) {
      throw createError({ statusCode: 409, statusMessage: 'cannot disable the last active admin' });
    }
  }

  await db.update(users).set({ status: 'disabled' }).where(eq(users.id, id));
  await destroyAllSessionsForUser(id);
  await audit({ userId: actor.id, action: 'user_disable', targetType: 'user', targetId: id });
  setResponseStatus(event, 204);
  return null;
});
