import { describe, it, expect, vi } from 'vitest';

// Stub adapter modules so the registry test does not pull SDK/fetch wiring.
vi.mock('./fcm-adapter', () => ({ fcmAdapter: { __id: 'fcm' } }));
vi.mock('./huawei-adapter', () => ({ huaweiAdapter: { __id: 'huawei' } }));

import { getAdapter } from './registry';

describe('getAdapter', () => {
  it('returns the FCM adapter for "fcm"', () => {
    expect((getAdapter('fcm') as unknown as { __id: string }).__id).toBe('fcm');
  });
  it('returns the Huawei adapter for "huawei"', () => {
    expect((getAdapter('huawei') as unknown as { __id: string }).__id).toBe('huawei');
  });
  it('throws for an unknown provider', () => {
    // @ts-expect-error deliberately invalid provider
    expect(() => getAdapter('apns')).toThrow(/unknown provider/i);
  });
});
