import type { H3Event } from 'h3';
import { createError } from 'h3';
import { requireUser } from './guard';
import { users } from '~~/server/db/schema';

// 401 if unauthenticated/disabled (via requireUser); 403 unless role='admin'.
export async function requireAdmin(event: H3Event): Promise<typeof users.$inferSelect> {
  const user = await requireUser(event);
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'admin only' });
  return user;
}
