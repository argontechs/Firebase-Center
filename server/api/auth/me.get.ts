import { defineEventHandler } from 'h3';
import { requireUser } from '~/server/utils/auth/guard';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);   // throws 401 when no session / disabled
  return { user: { id: user.id, email: user.email, role: user.role }, mustChangePassword: user.mustChangePassword };
});
