import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { readBody, setResponseHeader, createError, defineEventHandler } from 'h3';
import { db } from '~/server/db/client';
import { users } from '~/server/db/schema';
import { verifyPassword } from '~/server/utils/auth/password';
import { createSession } from '~/server/utils/auth/session';
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '~/server/utils/auth/rate-limit';
import { audit } from '~/server/utils/audit';
import { clientIp } from '~/server/utils/http';

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body' });
  const email = parsed.data.email.toLowerCase();
  const ip = clientIp(event);
  const key = { email, ip };

  const gate = checkLoginAllowed(key);
  if (!gate.allowed) {
    await audit({ userId: null, action: 'login_failure', targetType: 'email', targetId: email, meta: { ip, reason: 'rate_limited' } });
    throw createError({ statusCode: 429, statusMessage: 'too many attempts', data: { retryAfterMs: gate.retryAfterMs } });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const ok = user && user.status === 'active' && (await verifyPassword(user.passwordHash, parsed.data.password));
  if (!ok) {
    recordLoginFailure(key);
    await audit({ userId: user?.id ?? null, action: 'login_failure', targetType: 'email', targetId: email, meta: { ip } });
    throw createError({ statusCode: 401, statusMessage: 'invalid credentials' });
  }

  recordLoginSuccess(key);
  const { cookie } = await createSession(user.id);
  setResponseHeader(event, 'Set-Cookie', cookie);
  await audit({ userId: user.id, action: 'login_success', targetType: 'user', targetId: user.id, meta: { ip } });
  return { user: { id: user.id, email: user.email, role: user.role }, mustChangePassword: user.mustChangePassword };
});
