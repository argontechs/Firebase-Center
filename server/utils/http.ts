import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';

export function clientIp(event: H3Event): string {
  const fwd = getRequestHeader(event, 'x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return event.node.req.socket.remoteAddress ?? 'unknown';
}
