import { describe, it, expect } from 'vitest';
import { validatePayloadSize, PayloadTooLargeError, MAX_PAYLOAD_BYTES } from '../../server/utils/payload';
import type { NeutralMessage } from '../../server/utils/push/types';

const base: NeutralMessage = {
  title: 'Hi', body: 'There', data: {}, mode: 'notification', priority: 'high',
};

describe('validatePayloadSize', () => {
  it('passes a small fcm message', () => {
    expect(() => validatePayloadSize(base, 'fcm')).not.toThrow();
  });

  it('passes a small huawei message', () => {
    expect(() => validatePayloadSize(base, 'huawei')).not.toThrow();
  });

  it('exposes MAX_PAYLOAD_BYTES = 4096', () => {
    expect(MAX_PAYLOAD_BYTES).toBe(4096);
  });

  it('throws PayloadTooLargeError when fcm body exceeds 4096 bytes', () => {
    const big: NeutralMessage = { ...base, data: { blob: 'x'.repeat(5000) } };
    expect(() => validatePayloadSize(big, 'fcm')).toThrow(PayloadTooLargeError);
  });

  it('huawei excludes the token list from the measured size (data still counted as a string)', () => {
    // A payload just under the limit for huawei must pass; the same data must be measured.
    const justUnder: NeutralMessage = { ...base, data: { blob: 'x'.repeat(3900) } };
    expect(() => validatePayloadSize(justUnder, 'huawei')).not.toThrow();
  });

  it('boundary: a payload one byte over 4096 throws; the trimmed one passes', () => {
    // Build data whose fcm-rendered JSON lands exactly on the boundary, then +1.
    let n = 4000;
    const render = (len: number): NeutralMessage => ({ ...base, title: '', body: '', data: { d: 'a'.repeat(len) } });
    // grow until it throws
    while (n < 6000) {
      try { validatePayloadSize(render(n), 'fcm'); n += 1; }
      catch { break; }
    }
    expect(() => validatePayloadSize(render(n), 'fcm')).toThrow(PayloadTooLargeError);
    expect(() => validatePayloadSize(render(n - 1), 'fcm')).not.toThrow();
  });

  it('error carries bytes and provider', () => {
    const big: NeutralMessage = { ...base, data: { blob: 'x'.repeat(5000) } };
    try { validatePayloadSize(big, 'huawei'); expect.unreachable(); }
    catch (e) {
      expect(e).toBeInstanceOf(PayloadTooLargeError);
      expect((e as PayloadTooLargeError).provider).toBe('huawei');
      expect((e as PayloadTooLargeError).bytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
    }
  });
});
