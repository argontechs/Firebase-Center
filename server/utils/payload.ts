import type { NeutralMessage, Provider } from '~~/server/utils/push/types';

// ---------------------------------------------------------------------------
// Payload size validation
// ---------------------------------------------------------------------------

export const MAX_PAYLOAD_BYTES = 4096;

export class PayloadTooLargeError extends Error {
  readonly bytes: number;
  readonly provider: Provider;
  constructor(bytes: number, provider: Provider) {
    super(`Rendered ${provider} payload is ${bytes} bytes, exceeds ${MAX_PAYLOAD_BYTES}`);
    this.name = 'PayloadTooLargeError';
    this.bytes = bytes;
    this.provider = provider;
  }
}

/**
 * Renders a provider-shaped body WITHOUT the recipient/token list and measures
 * its byte length.  Both providers cap at 4096 bytes.
 *
 * - FCM: `data` is a flat string->string map; token is excluded (single-message shape).
 * - Huawei: `data` is a single JSON-encoded STRING (ref §3); token list excluded.
 *
 * Throws PayloadTooLargeError if the rendered body exceeds MAX_PAYLOAD_BYTES.
 */
export function renderBodyForSizing(message: NeutralMessage, provider: Provider): unknown {
  const notificationBlock =
    message.mode === 'notification'
      ? {
          notification: {
            title: message.title,
            body: message.body,
            ...(message.image ? { image: message.image } : {}),
          },
        }
      : {};

  if (provider === 'huawei') {
    // Huawei: data must be a JSON-encoded string (ref §3); token list excluded.
    // The wire body always includes validate_only and the static android block
    // (urgency, category, notification.importance) — mirror them here so the
    // sizing check accounts for the full ~104-byte overhead and cannot produce
    // a false-pass (80300008 on the wire after passing the pre-flight check).
    const urgency = message.priority === 'high' ? 'HIGH' : 'NORMAL';
    const importance = message.priority === 'high' ? 'HIGH' : 'NORMAL';
    const category = message.mode === 'notification' ? 'IM' : 'PLAY_VOICE';
    return {
      validate_only: false,
      message: {
        data: JSON.stringify(message.data ?? {}),
        android: { urgency, category, notification: { importance } },
        ...notificationBlock,
      },
    };
  }

  // FCM: data is a flat string->string map; token excluded.
  return {
    message: {
      ...notificationBlock,
      data: message.data ?? {},
    },
  };
}

export function validatePayloadSize(message: NeutralMessage, provider: Provider): void {
  const body = renderBodyForSizing(message, provider);
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(bytes, provider);
  }
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
