import { z } from 'zod';
import { readBody, createError, defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { hashPassword } from '~~/server/utils/auth/password';
import { validatePasswordStrength } from '~~/server/db/seed';
import { requireAdmin } from '~~/server/utils/auth/require-admin';
import { audit } from '~~/server/utils/audit';

const Body = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'operator']).default('operator'),
  password: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requireAdmin(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body' });
  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) throw createError({ statusCode: 400, statusMessage: `password ${strength.reason}` });

  const [created] = await db.insert(users).values({
    email: parsed.data.email.toLowerCase(),
    passwordHash: await hashPassword(parsed.data.password),
    role: parsed.data.role,
    status: 'active',
    mustChangePassword: true,
  }).returning();
  await audit({ userId: actor.id, action: 'user_create', targetType: 'user', targetId: created.id, meta: { role: created.role } });
  return { id: created.id, email: created.email, role: created.role };
});
