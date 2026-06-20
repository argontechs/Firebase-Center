import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';

/**
 * Parse NUXT_TRUST_PROXY:
 *  - unset / "false" / "0" → 0 (do not trust XFF at all)
 *  - "true" / "1"          → 1 (trust one hop; strip the rightmost entry which is the load-balancer)
 *  - any positive integer N → trust N hops
 */
function trustedProxyHops(): number {
  const raw = process.env.NUXT_TRUST_PROXY;
  if (!raw || raw === 'false' || raw === '0') return 0;
  if (raw === 'true') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Return the "real" client IP.
 *
 * When NUXT_TRUST_PROXY is falsy (the default), X-Forwarded-For is completely
 * ignored — an attacker cannot spoof a different IP per request to dodge the
 * per-IP login lockout.
 *
 * When NUXT_TRUST_PROXY=N (N ≥ 1) we take the N-th entry from the RIGHT of
 * the XFF list (0-indexed: entry at position length-N-1).  With one trusted
 * reverse-proxy hop (N=1) that is the entry your load-balancer appended, which
 * is the true client address.
 */
export function clientIp(event: H3Event): string {
  const socket = event.node.req.socket?.remoteAddress ?? 'unknown';
  const hops = trustedProxyHops();
  if (hops === 0) return socket;

  const fwd = getRequestHeader(event, 'x-forwarded-for');
  if (!fwd) return socket;

  const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
  // XFF is appended left→right; the rightmost `hops` entries were written by trusted
  // proxies.  The real client IP is the entry immediately to the left of those, i.e.
  // index = parts.length - hops - 1.  Clamp to 0 so short lists always resolve.
  const idx = Math.max(0, parts.length - hops - 1);
  return parts[idx] ?? socket;
}
