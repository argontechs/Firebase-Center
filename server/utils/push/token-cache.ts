import type { AccessToken, ResolvedCredential } from './types';

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh when < 5 min remain

interface Entry {
  token?: AccessToken;
  inflight?: Promise<AccessToken>;
}

const cache = new Map<string, Entry>();

function isFresh(token: AccessToken | undefined): token is AccessToken {
  return !!token && token.expiresAt - Date.now() > REFRESH_SKEW_MS;
}

export async function getAccessToken(
  credential: ResolvedCredential,
  mint: (c: ResolvedCredential) => Promise<AccessToken>,
): Promise<string> {
  const key = credential.id;
  let entry = cache.get(key);
  if (!entry) {
    entry = {};
    cache.set(key, entry);
  }

  if (isFresh(entry.token)) {
    return entry.token.token;
  }

  if (entry.inflight) {
    return (await entry.inflight).token;
  }

  const inflight = (async () => {
    const minted = await mint(credential);
    return minted;
  })();
  entry.inflight = inflight;

  try {
    const minted = await inflight;
    entry.token = minted;
    return minted.token;
  } finally {
    // clear in-flight regardless of success so the next call can retry on failure
    if (cache.get(key) === entry) entry.inflight = undefined;
  }
}

export function invalidateToken(credentialId: string): void {
  cache.delete(credentialId);
}
