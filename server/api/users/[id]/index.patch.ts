import { z } from 'zod';
import { eq, and, ne, count } from 'drizzle-orm';
import { readBody, getRouterParam, createError, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { requireAdmin } from '~~/server/utils/auth/require-admin';
import { audit } from '~~/server/utils/audit';

const Body = z.object({ role: z.enum(['admin', 'operator']) });

export default defineEventHandler(async (event) => {
  const actor = await requireAdmin(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing id' });
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body' });

  // Last-admin lockout guard: reject if downgrading would leave zero active admins.
  if (parsed.data.role !== 'admin') {
    const [targetRow] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, id));
    if (targetRow?.role === 'admin') {
      const [{ value: activeAdminCount }] = await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, id)));
      if (activeAdminCount === 0) {
        throw createError({ statusCode: 409, statusMessage: 'cannot remove the last active admin' });
      }
    }
  }

  const [updated] = await db.update(users).set({ role: parsed.data.role }).where(eq(users.id, id)).returning();
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'not found' });
  await audit({ userId: actor.id, action: 'role_change', targetType: 'user', targetId: id, meta: { role: parsed.data.role } });
  return { id: updated.id, email: updated.email, role: updated.role };
});
