import { defineEventHandler } from 'h3';
import { db } from '~~/server/db/client';
import { users } from '~~/server/db/schema';
import { requireAdmin } from '~~/server/utils/auth/require-admin';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const rows = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    status: users.status,
    createdAt: users.createdAt,
  }).from(users);
  return rows;
});
