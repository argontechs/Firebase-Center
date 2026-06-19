import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { readBody, setResponseHeader, setResponseStatus, createError, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { hashPassword, verifyPassword } from '~~/server/utils/auth/password';
import { validatePasswordStrength } from '~~/server/db/seed';
import { requireUser } from '~~/server/utils/auth/guard';
import { destroyAllSessionsForUser, createSession } from '~~/server/utils/auth/session';
import { audit } from '~~/server/utils/audit';

const Body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

export default defineEventHandler(async (event) => {
  // requireUser enforces session validity AND user.status === 'active'; disabled operators cannot change their password.
  const user = await requireUser(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body' });

  if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
    throw createError({ statusCode: 401, statusMessage: 'invalid current password' });
  }
  const strength = validatePasswordStrength(parsed.data.newPassword);
  if (!strength.ok) throw createError({ statusCode: 400, statusMessage: `new password ${strength.reason}` });

  await db.update(users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false })
    .where(eq(users.id, user.id));
  await destroyAllSessionsForUser(user.id);                 // invalidate everything, including this one
  const { cookie } = await createSession(user.id);          // re-issue so the operator stays logged in
  setResponseHeader(event, 'Set-Cookie', cookie);
  await audit({ userId: user.id, action: 'password_change', targetType: 'user', targetId: user.id });
  setResponseStatus(event, 204);
  return null;
});
