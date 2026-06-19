import { describe, it, expect } from 'vitest';
import { validateRows } from '../../../server/utils/import/validate';
import type { ParsedRow } from '../../../server/utils/import/parse';

const base = (over: Partial<ParsedRow>): ParsedRow => ({
  rowNumber: 1, token: 't', provider: 'fcm', platform: 'android',
  externalUserId: null, attributes: {}, ...over,
});

describe('validateRows', () => {
  it('accepts fcm with ios/android/web', () => {
    const r = validateRows([
      base({ rowNumber: 1, provider: 'fcm', platform: 'ios' }),
      base({ rowNumber: 2, provider: 'fcm', platform: 'android' }),
      base({ rowNumber: 3, provider: 'fcm', platform: 'web' }),
    ]);
    expect(r.valid.map((v) => v.rowNumber)).toEqual([1, 2, 3]);
    expect(r.rejected).toEqual([]);
  });

  it('accepts huawei only with huawei platform', () => {
    const r = validateRows([base({ provider: 'huawei', platform: 'huawei' })]);
    expect(r.valid).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('rejects huawei provider with non-huawei platform as PLATFORM_INCONSISTENT', () => {
    const r = validateRows([base({ rowNumber: 7, provider: 'huawei', platform: 'android' })]);
    expect(r.valid).toEqual([]);
    expect(r.rejected).toEqual([{ rowNumber: 7, reason: 'PLATFORM_INCONSISTENT' }]);
  });

  it('rejects fcm provider with huawei platform as PLATFORM_INCONSISTENT', () => {
    const r = validateRows([base({ rowNumber: 8, provider: 'fcm', platform: 'huawei' })]);
    expect(r.rejected).toEqual([{ rowNumber: 8, reason: 'PLATFORM_INCONSISTENT' }]);
  });

  it('rejects missing token / unrecognized provider / missing platform', () => {
    const r = validateRows([
      base({ rowNumber: 1, token: null }),
      base({ rowNumber: 2, provider: 'apns' }),
      base({ rowNumber: 3, platform: null }),
    ]);
    expect(r.rejected).toEqual([
      { rowNumber: 1, reason: 'TOKEN_MISSING' },
      { rowNumber: 2, reason: 'PROVIDER_UNRECOGNIZED' },
      { rowNumber: 3, reason: 'PLATFORM_MISSING' },
    ]);
  });
});
