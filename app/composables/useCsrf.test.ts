import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);
// minimal Vue ref shim so the composable runs outside a component
vi.mock('vue', () => ({ ref: (v: any) => ({ value: v }) }));

import { useCsrf } from './useCsrf';

beforeEach(() => fetchMock.mockReset());

describe('useCsrf', () => {
  it('fetches and stores the token, then exposes it as a header', async () => {
    fetchMock.mockResolvedValueOnce({ token: 'abc123' });
    const csrf = useCsrf();
    await csrf.fetchToken();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/csrf');
    expect(csrf.token.value).toBe('abc123');
    expect(csrf.headers()).toEqual({ 'x-csrf-token': 'abc123' });
  });

  it('headers() is empty before a token is fetched', () => {
    const csrf = useCsrf();
    expect(csrf.headers()).toEqual({});
  });
});
