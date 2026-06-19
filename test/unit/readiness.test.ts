import { describe, it, expect } from 'vitest';
import { isReady } from '~/server/utils/credentials/readiness';
import type { appCredentials } from '~/server/db/schema';

type Row = typeof appCredentials.$inferSelect;
const base = {
  id: 'c1', appId: 'a1', label: null,
  secretCiphertext: 'x', secretNonce: 'x', secretTag: 'x', keyVersion: 1,
  configuredAt: new Date(), rotatedAt: null,
} as unknown as Row;

describe('isReady', () => {
  it('FCM android is ready once configured', () => {
    expect(isReady({ ...base, provider: 'fcm', platform: 'android', metaJsonb: {} })).toBe(true);
  });
  it('FCM ios is NOT ready without APNs .p8', () => {
    expect(isReady({ ...base, provider: 'fcm', platform: 'ios', metaJsonb: {} })).toBe(false);
    expect(isReady({ ...base, provider: 'fcm', platform: 'ios', metaJsonb: { apns_p8_uploaded: true } })).toBe(true);
  });
  it('FCM web is NOT ready without VAPID', () => {
    expect(isReady({ ...base, provider: 'fcm', platform: 'web', metaJsonb: {} })).toBe(false);
    expect(isReady({ ...base, provider: 'fcm', platform: 'web', metaJsonb: { vapid_present: true } })).toBe(true);
  });
  it('Huawei is NOT ready until Push Kit enabled', () => {
    expect(isReady({ ...base, provider: 'huawei', platform: 'huawei', metaJsonb: {} })).toBe(false);
    expect(isReady({ ...base, provider: 'huawei', platform: 'any', metaJsonb: { push_kit_enabled: true } })).toBe(true);
  });
});
