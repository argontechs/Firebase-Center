import type { NeutralMessage } from '~~/server/utils/push/types';

// ---------------------------------------------------------------------------
// Payload size validation
// ---------------------------------------------------------------------------

export class PayloadTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE';
  constructor(message = 'Push payload exceeds the 4 KB limit') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Validates that the serialized push payload does not exceed 4 096 bytes.
 * For Huawei the token list is excluded (measured separately per batch).
 */
export function validatePayloadSize(message: NeutralMessage, _provider?: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
  if (bytes > 4096) throw new PayloadTooLargeError();
}

// ---------------------------------------------------------------------------
// Huawei click_action.type:1 validation (ref §3/§5, Addendum D)
// ---------------------------------------------------------------------------

export class ClickActionError extends Error {
  readonly code = '80100003';
  constructor(message = 'Huawei click_action.type:1 requires intent or action') {
    super(message);
    this.name = 'ClickActionError';
  }
}

/**
 * Validates the Huawei click_action embedded in message.data['click_action'].
 * A type:1 (open custom app page) action MUST carry an intent or action field,
 * otherwise Huawei returns 80100003.
 *
 * The neutral message carries the tap action under data.click_action as a JSON
 * string: { type, intent?, action? }.
 *
 * Throws ClickActionError when type===1 (or "1") and BOTH intent and action are
 * absent or empty.  No-op for any other type, or when no click_action is present.
 */
export function validateHuaweiClickAction(message: NeutralMessage): void {
  const rawCa = (message.data ?? {})['click_action'];
  if (!rawCa) return;
  let parsed: { type?: number | string; intent?: string; action?: string };
  try {
    parsed = JSON.parse(rawCa);
  } catch {
    // Unparseable click_action is not a type:1 assertion — leave it to the wire layer.
    return;
  }
  if (String(parsed.type) !== '1') return;
  const hasIntent = typeof parsed.intent === 'string' && parsed.intent.length > 0;
  const hasAction = typeof parsed.action === 'string' && parsed.action.length > 0;
  if (!hasIntent && !hasAction) throw new ClickActionError();
}
