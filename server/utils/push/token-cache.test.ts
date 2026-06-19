import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAccessToken, invalidateToken } from './token-cache';
import type { ResolvedCredential, AccessToken } from './types';

function cred(id: string): ResolvedCredential {
  return { id, appId: 'app-1', provider: 'fcm', platform: 'android', secret: {}, meta: {} };
}

describe('token-cache', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); invalidateToken('c1'); invalidateToken('c2'); });

  it('mints on first call and caches by credential id', async () => {
    const mint = vi.fn(async (): Promise<AccessToken> => ({ token: 'T1', expiresAt: 3_600_000 }));
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1');
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('keeps separate entries per credential id', async () => {
    const mint = vi.fn(async (c: ResolvedCredential): Promise<AccessToken> => ({
      token: `T-${c.id}`, expiresAt: 3_600_000,
    }));
    expect(await getAccessToken(cred('c1'), mint)).toBe('T-c1');
    expect(await getAccessToken(cred('c2'), mint)).toBe('T-c2');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('refreshes proactively when < 5 min before expiry', async () => {
    let n = 0;
    const mint = vi.fn(async (): Promise<AccessToken> => {
      n += 1;
      return { token: `T${n}`, expiresAt: Date.now() + 3_600_000 };
    });
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1'); // expires at 3_600_000
    vi.setSystemTime(3_600_000 - 299_000);                     // < 300s remaining
    expect(await getAccessToken(cred('c1'), mint)).toBe('T2'); // re-minted
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does NOT refresh when > 5 min remain', async () => {
    const mint = vi.fn(async (): Promise<AccessToken> => ({ token: 'T1', expiresAt: 3_600_000 }));
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1');
    vi.setSystemTime(3_600_000 - 301_000); // 301s remaining
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent mints for the same credential into one', async () => {
    let resolveMint!: (t: AccessToken) => void;
    const mint = vi.fn(() => new Promise<AccessToken>((r) => { resolveMint = r; }));
    const p1 = getAccessToken(cred('c1'), mint);
    const p2 = getAccessToken(cred('c1'), mint);
    resolveMint({ token: 'T1', expiresAt: 3_600_000 });
    expect(await p1).toBe('T1');
    expect(await p2).toBe('T1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('invalidateToken forces a re-mint', async () => {
    // mock.calls.length is 1 on first call (already registered), 2 on second — so T1, T2.
    const mint = vi.fn(async (): Promise<AccessToken> => ({ token: `T${mint.mock.calls.length}`, expiresAt: 3_600_000 }));
    expect(await getAccessToken(cred('c1'), mint)).toBe('T1');
    invalidateToken('c1');
    expect(await getAccessToken(cred('c1'), mint)).toBe('T2');
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
