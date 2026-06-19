import { setResponseHeader, defineEventHandler } from 'h3';
import { issueCsrfToken, serializeCsrfCookie } from '~~/server/utils/auth/csrf';

export default defineEventHandler((event) => {
  const token = issueCsrfToken();
  setResponseHeader(event, 'Set-Cookie', serializeCsrfCookie(token));
  return { token };
});
