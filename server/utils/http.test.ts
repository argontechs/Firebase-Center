/**
 * Tests for clientIp() trusted-proxy logic (F8 fix).
 *
 * clientIp() reads NUXT_TRUST_PROXY at call time; we manipulate process.env
 * directly and restore it in afterEach so tests are hermetic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { clientIp } from './http';

// We test clientIp() without a real h3 runtime — just craft minimal fake events
// that satisfy the two call sites used by the function:
//   - getRequestHeader(event, 'x-forwarded-for')  → event._headers['x-forwarded-for']
//   - event.node.req.socket?.remoteAddress
//
// The h3 module is NOT mocked here; instead we rely on the fact that h3's
// getRequestHeader reads from the node IncomingMessage headers object, which we
// stub via event.node.req.headers.
function fakeEvent(opts: {
  socketIp?: string;
  xff?: string;
}): any {
  return {
    node: {
      req: {
        socket: { remoteAddress: opts.socketIp ?? '10.0.0.1' },
        headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {},
      },
    },
  };
}

const savedEnv: string | undefined = process.env.NUXT_TRUST_PROXY;

afterEach(() => {
  // Restore the env var after each test.
  if (savedEnv === undefined) {
    delete process.env.NUXT_TRUST_PROXY;
  } else {
    process.env.NUXT_TRUST_PROXY = savedEnv;
  }
});

describe('clientIp — trust proxy OFF (default)', () => {
  it('returns socket.remoteAddress when XFF is absent', () => {
    delete process.env.NUXT_TRUST_PROXY;
    const event = fakeEvent({ socketIp: '192.168.1.5' });
    expect(clientIp(event)).toBe('192.168.1.5');
  });

  it('ignores X-Forwarded-For header and returns socket IP (bypass prevention)', () => {
    delete process.env.NUXT_TRUST_PROXY;
    const event = fakeEvent({ socketIp: '10.0.0.1', xff: '1.2.3.4' });
    // Even though XFF claims 1.2.3.4, the socket address must be returned.
    expect(clientIp(event)).toBe('10.0.0.1');
  });

  it('NUXT_TRUST_PROXY=false also ignores XFF', () => {
    process.env.NUXT_TRUST_PROXY = 'false';
    const event = fakeEvent({ socketIp: '10.0.0.2', xff: '9.9.9.9' });
    expect(clientIp(event)).toBe('10.0.0.2');
  });

  it('NUXT_TRUST_PROXY=0 also ignores XFF', () => {
    process.env.NUXT_TRUST_PROXY = '0';
    const event = fakeEvent({ socketIp: '10.0.0.3', xff: '9.9.9.9' });
    expect(clientIp(event)).toBe('10.0.0.3');
  });

  it('spoofed XFF does not produce a distinct per-IP bucket (lockout cannot be bypassed)', () => {
    delete process.env.NUXT_TRUST_PROXY;
    const socketIp = '172.16.0.1';
    // Two requests with different spoofed XFF values but same socket IP.
    const e1 = fakeEvent({ socketIp, xff: '5.5.5.1' });
    const e2 = fakeEvent({ socketIp, xff: '5.5.5.2' });
    // Both must resolve to the same underlying socket address, not the spoofed values.
    expect(clientIp(e1)).toBe(socketIp);
    expect(clientIp(e2)).toBe(socketIp);
    // And neither must resolve to any of the spoofed values.
    expect(clientIp(e1)).not.toBe('5.5.5.1');
    expect(clientIp(e2)).not.toBe('5.5.5.2');
  });
});

describe('clientIp — trust proxy ON (NUXT_TRUST_PROXY=1)', () => {
  it('returns XFF entry when one hop is trusted and one entry present', () => {
    process.env.NUXT_TRUST_PROXY = '1';
    // XFF: "client" (written by proxy); socket is the proxy itself.
    const event = fakeEvent({ socketIp: '10.0.0.1', xff: '203.0.113.5' });
    expect(clientIp(event)).toBe('203.0.113.5');
  });

  it('strips rightmost trusted-proxy entry and returns the real client', () => {
    process.env.NUXT_TRUST_PROXY = '1';
    // XFF: "realclient, trustedproxy" — trustedproxy appended itself; real client is first.
    // With hops=1: idx = max(0, 2 - 1 - 1) = 0 → realclient ✓
    const event = fakeEvent({ socketIp: '10.0.0.1', xff: '203.0.113.5, 10.0.0.1' });
    expect(clientIp(event)).toBe('203.0.113.5');
  });

  it('with 2 trusted hops peels back two rightmost entries', () => {
    process.env.NUXT_TRUST_PROXY = '2';
    // XFF: "realclient, proxy1, proxy2" — idx = max(0, 3 - 2 - 1) = 0 → realclient ✓
    const event = fakeEvent({ socketIp: '10.0.0.1', xff: '203.0.113.5, 10.0.0.2, 10.0.0.3' });
    expect(clientIp(event)).toBe('203.0.113.5');
  });

  it('falls back to socket when no XFF header present even with trust enabled', () => {
    process.env.NUXT_TRUST_PROXY = '1';
    const event = fakeEvent({ socketIp: '192.168.0.99' });
    expect(clientIp(event)).toBe('192.168.0.99');
  });

  it('NUXT_TRUST_PROXY=true is treated as 1 hop', () => {
    process.env.NUXT_TRUST_PROXY = 'true';
    const event = fakeEvent({ socketIp: '10.0.0.1', xff: '203.0.113.9' });
    expect(clientIp(event)).toBe('203.0.113.9');
  });
});
