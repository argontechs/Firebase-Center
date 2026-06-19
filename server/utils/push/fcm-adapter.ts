import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type {
  AccessToken,
  DeliveryResult,
  Disposition,
  NeutralMessage,
  PushProvider,
  Recipient,
  ResolvedCredential,
  WireMessage,
} from './types';

const CHUNK = 500;
const MAX_CONCURRENCY = 100;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appName(c: ResolvedCredential): string {
  return `fcm-${c.id}`;
}

function appFor(c: ResolvedCredential) {
  const name = appName(c);
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  return initializeApp(
    { credential: cert(c.secret as Record<string, string>) },
    name,
  );
}

function buildRaw(message: NeutralMessage): Record<string, unknown> {
  const apnsPriority = message.priority === 'high' ? '10' : '5';
  const raw: Record<string, unknown> = {
    data: { ...message.data },
    android: { priority: message.priority },
    apns: { headers: { 'apns-priority': apnsPriority } },
  };
  if (message.mode === 'notification') {
    const notification: Record<string, string> = {
      title: message.title,
      body: message.body,
    };
    if (message.image) notification.image = message.image;
    raw.notification = notification;
  }
  return raw;
}

// FCM Admin SDK error code -> (status, disposition)
//
// Code strings are prefixed with 'messaging/' by FirebaseMessagingError (constructor line 277
// in firebase-admin/lib/messaging/error.js).  The suffix is MessagingErrorCode[key].
//
// Rate-limit mapping (confirmed from error.js):
//   QUOTA_EXCEEDED        → MESSAGE_RATE_EXCEEDED → 'messaging/message-rate-exceeded'
//   RESOURCE_EXHAUSTED    → MESSAGE_RATE_EXCEEDED → 'messaging/message-rate-exceeded'
//   DeviceMessageRateExceeded → DEVICE_MESSAGE_RATE_EXCEEDED → 'messaging/device-message-rate-exceeded'
//
// Credential mismatch mapping (confirmed from error.js):
//   SENDER_ID_MISMATCH / PERMISSION_DENIED / MismatchSenderId
//       → MISMATCHED_CREDENTIAL → 'messaging/mismatched-credential'
//   This is a configuration defect — retrying never self-heals → FIX_CREDENTIALS.
function mapFcmError(code: string): { status: 'failed' | 'invalid'; disposition: Disposition } {
  switch (code) {
    case 'messaging/registration-token-not-registered':
      return { status: 'invalid', disposition: 'DELETE_TOKEN' };
    case 'messaging/invalid-argument':
    case 'messaging/payload-size-limit-exceeded':
      return { status: 'failed', disposition: 'FIX_REQUEST' };
    case 'messaging/third-party-auth-error':
    // SENDER_ID_MISMATCH / PERMISSION_DENIED map here; wrong sender never self-heals.
    case 'messaging/mismatched-credential':
      return { status: 'failed', disposition: 'FIX_CREDENTIALS' };
    case 'messaging/internal-error':
    case 'messaging/server-unavailable':
    // Real rate-limit codes from the Admin SDK (QUOTA_EXCEEDED/RESOURCE_EXHAUSTED both map
    // to MESSAGE_RATE_EXCEEDED; DeviceMessageRateExceeded maps to DEVICE_MESSAGE_RATE_EXCEEDED).
    case 'messaging/message-rate-exceeded':
    case 'messaging/device-message-rate-exceeded':
      return { status: 'failed', disposition: 'RETRY_BACKOFF' };
    default:
      return { status: 'failed', disposition: 'RETRY_BACKOFF' };
  }
}

// Extract a Retry-After (seconds or HTTP-date) from a firebase-admin error's
// httpResponse headers. Returns epoch-delta milliseconds, or undefined when
// absent / unparseable.
function retryAfterMsFromError(error: unknown): number | undefined {
  const headers = (
    error as {
      httpResponse?: { headers?: { get?(k: string): string | null } };
    }
  )?.httpResponse?.headers;
  const raw = headers?.get?.('retry-after');
  if (!raw) return undefined;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds)) return Math.max(0, Math.round(asSeconds * 1000));
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const fcmAdapter: PushProvider = {
  async mintToken(credential: ResolvedCredential): Promise<AccessToken> {
    const app = appFor(credential);
    const token = await (
      app.options.credential as {
        getAccessToken(): Promise<{ access_token: string; expires_in: number }>;
      }
    ).getAccessToken();
    return {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  },

  render(message: NeutralMessage): WireMessage {
    return { provider: 'fcm', raw: buildRaw(message) };
  },

  async send(
    credential: ResolvedCredential,
    message: WireMessage,
    recipients: Recipient[],
  ): Promise<DeliveryResult[]> {
    // Architectural note: send() uses getMessaging(appFor(credential)) which delegates
    // credential refresh to the Firebase Admin SDK's internal reactive mechanism (re-mint
    // on 401).  It does NOT consume the token-cache in server/utils/push/token-cache.ts,
    // whose proactive <5-min refresh guarantee only applies to callers that thread
    // getAccessToken(credential, fcmAdapter.mintToken) explicitly.  For FCM sends this
    // split is tolerable because the SDK is authoritative, but callers that need the
    // proactive-refresh SLA must wrap send() with an external token-cache round-trip.
    const messaging = getMessaging(appFor(credential));
    const base = message.raw as Record<string, unknown>;
    const groups = chunk(recipients, CHUNK);
    const results: DeliveryResult[] = [];

    // Process at most MAX_CONCURRENCY chunks concurrently.
    // Each chunk is ≤500 tokens; sendEachForMulticast fans out to one
    // HTTP/2 request per token internally (no over-the-wire batch).
    for (let i = 0; i < groups.length; i += MAX_CONCURRENCY) {
      const slice = groups.slice(i, i + MAX_CONCURRENCY);
      const settled = await Promise.all(
        slice.map(async (group) => {
          const resp = await messaging.sendEachForMulticast({
            tokens: group.map((r) => r.token),
            ...base,
          });
          return group.map((r, idx): DeliveryResult => {
            const res = resp.responses[idx];
            if (res.success) {
              return {
                token: r.token,
                deviceId: r.deviceId,
                status: 'sent',
                responseMeta: { messageId: res.messageId },
              };
            }
            const code =
              (res.error as { code?: string })?.code ?? 'messaging/internal-error';
            const { status, disposition } = mapFcmError(code);
            const result: DeliveryResult = {
              token: r.token,
              deviceId: r.deviceId,
              status,
              disposition,
              errorCode: code,
            };
            if (disposition === 'RETRY_BACKOFF') {
              const retryAfterMs = retryAfterMsFromError(res.error);
              if (retryAfterMs !== undefined) {
                result.responseMeta = { retryAfterMs };
              }
            }
            return result;
          });
        }),
      );
      for (const g of settled) results.push(...g);
    }
    return results;
  },
};
