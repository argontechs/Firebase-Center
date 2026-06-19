import { describe, it, expect } from 'vitest';
import { validateHuaweiClickAction, ClickActionError } from '../../server/utils/payload';
import type { NeutralMessage } from '../../server/utils/push/types';

function msg(clickAction?: Record<string, string>): NeutralMessage {
  return {
    title: 'Hi', body: 'There',
    data: clickAction ? { click_action: JSON.stringify(clickAction) } : {},
    mode: 'notification', priority: 'high',
  };
}

describe('validateHuaweiClickAction', () => {
  it('rejects type:1 with neither intent nor action (maps to 80100003)', () => {
    try { validateHuaweiClickAction(msg({ type: '1' })); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ClickActionError); expect((e as ClickActionError).code).toBe('80100003'); }
  });

  it('accepts type:1 when action is set', () => {
    expect(() => validateHuaweiClickAction(msg({ type: '1', action: 'com.acme.OPEN_DETAIL' }))).not.toThrow();
  });

  it('accepts type:1 when intent is set', () => {
    expect(() => validateHuaweiClickAction(msg({ type: '1', intent: 'intent://detail#Intent;end' }))).not.toThrow();
  });

  it('is a no-op for type:2 (URL) without intent/action', () => {
    expect(() => validateHuaweiClickAction(msg({ type: '2' }))).not.toThrow();
  });

  it('is a no-op when no click_action is present', () => {
    expect(() => validateHuaweiClickAction(msg())).not.toThrow();
  });
});
