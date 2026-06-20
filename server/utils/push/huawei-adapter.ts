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
import { validateHuaweiClickAction } from '~~/server/utils/payload';
import { getAccessToken } from './token-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Allow test/smoke overrides via env vars (HUAWEI_OAUTH_URL / HUAWEI_BASE_URL).
// In production these are unset and fall back to the canonical Huawei endpoints.
const TOKEN_URL =
  process.env.HUAWEI_OAUTH_URL ?? 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const SEND_HOST = process.env.HUAWEI_BASE_URL ?? 'https://push-api.cloud.huawei.com';
const CHUNK = 1000;
const QPS_PACE_MS = 50; // self-imposed pacing between chunks (Huawei gives no Retry-After)

// ---------------------------------------------------------------------------
// Pinned Huawei secret blob shape (set at the M3 save boundary).
// ---------------------------------------------------------------------------

interface HuaweiSecret {
  appId: string;
  appSecret: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Extracts the list of illegal tokens from a Huawei partial-success (80100000) response.
 *
 * The real Huawei Push Kit API does NOT return illegal_tokens as a top-level array.
 * Instead it encodes them inside the `msg` field as a JSON string, e.g.:
 *   { code: '80100000', msg: '{"illegal_tokens":["t1","t2"]}', requestId: '...' }
 *
 * To remain forward-compatible with any future API revision that promotes the field
 * to the top level, we prefer a top-level string[] when present, and fall back to
 * parsing body.msg otherwise.
 */
function extractIllegalTokens(body: { illegal_tokens?: string[]; msg?: string }): Set<string> {
  // Forward-compat: prefer a top-level array if the API ever promotes the field.
  if (Array.isArray(body.illegal_tokens) && body.illegal_tokens.every((t) => typeof t === 'string')) {
    return new Set(body.illegal_tokens);
  }
  // Real Huawei API: tokens are nested inside msg as a JSON-encoded string.
  if (typeof body.msg === 'string') {
    try {
      const parsed = JSON.parse(body.msg) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'illegal_tokens' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).illegal_tokens)
      ) {
        const arr = (parsed as Record<string, unknown>).illegal_tokens as unknown[];
        return new Set(arr.filter((t): t is string => typeof t === 'string'));
      }
    } catch {
      // Unparseable msg — no illegal tokens to extract.
    }
  }
  return new Set<string>();
}

/**
 * Maps a Huawei body-level response code to a per-token outcome.
 *
 * HTTP 200 does NOT mean success — the real result is always in body.code.
 * 80300010 (token count > 1000): structurally-impossible chunk, non-transient;
 *   maps to FIX_REQUEST, NOT RETRY_BACKOFF (would retry forever otherwise).
 */
function mapHuaweiCode(
  code: string,
): { status: 'failed' | 'invalid'; disposition: Disposition } | 'ok' | 'partial' {
  switch (code) {
    case '80000000': return 'ok';
    case '80100000': return 'partial';
    // All tokens invalid / app unsubscribed
    case '80300007':
    case '80300002':
      return { status: 'invalid', disposition: 'DELETE_TOKEN' };
    // Auth failures
    case '80200001':
    case '80200003':
      return { status: 'failed', disposition: 'REAUTH' };
    // Structural / request defects — do NOT retry
    case '80100003': // click_action.type:1 missing intent/action
    case '80300008': // payload too large
    case '80300010': // token count > 1000 (chunk must never exceed CHUNK; non-transient)
    case '80300011': // token format invalid
      return { status: 'failed', disposition: 'FIX_REQUEST' };
    // Transient server errors
    case '81000001':
      return { status: 'failed', disposition: 'RETRY_BACKOFF' };
    // Unknown codes: treat as transient
    default:
      return { status: 'failed', disposition: 'RETRY_BACKOFF' };
  }
}

/**
 * Returns the push-api send URL.
 * Uses v2 (/v2/{project_id}/messages:send) when meta.project_id is present,
 * otherwise falls back to v1 (/v1/{appId}/messages:send).
 */
function sendUrl(credential: ResolvedCredential): string {
  const projectId = (credential.meta as { project_id?: string }).project_id;
  const appId = (credential.secret as HuaweiSecret).appId;
  return projectId
    ? `${SEND_HOST}/v2/${projectId}/messages:send`
    : `${SEND_HOST}/v1/${appId}/messages:send`;
}

/**
 * Builds the Huawei wire message body (without the token list, which is
 * injected per-chunk in send()).
 *
 * Key invariants:
 * - `data` must be a JSON string (not a nested object).
 * - `priority` maps to `android.urgency` (HIGH/NORMAL) and
 *   `android.notification.importance` (HIGH/NORMAL).
 * - click_action.type:1 validation is enforced here as defense-in-depth;
 *   the authoritative pre-flight is in M6 compose/create.
 */
function buildRaw(message: NeutralMessage): Record<string, unknown> {
  const urgency = message.priority === 'high' ? 'HIGH' : 'NORMAL';
  const importance = message.priority === 'high' ? 'HIGH' : 'NORMAL';

  const androidNotification: Record<string, unknown> = { importance };

  const inner: Record<string, unknown> = {
    data: JSON.stringify(message.data),
    android: {
      urgency,
      category: message.mode === 'notification' ? 'IM' : 'PLAY_VOICE',
      notification: androidNotification,
    },
  };

  if (message.mode === 'notification') {
    const notification: Record<string, string> = { title: message.title, body: message.body };
    if (message.image) notification.image = message.image;
    inner.notification = notification;
  }

  // Defense-in-depth: reject a type:1 tap action lacking intent/action.
  // The authoritative M6 pre-flight fires before compose; this guard ensures
  // a malformed message can never reach the wire even if bypassed.
  validateHuaweiClickAction(message);

  // Project a valid click_action into android.notification.click_action.
  const rawCa = (message.data ?? {})['click_action'];
  if (rawCa && message.mode === 'notification') {
    try {
      const ca = JSON.parse(rawCa) as { type?: number | string; intent?: string; action?: string };
      androidNotification.click_action = {
        type: Number(ca.type),
        ...(ca.intent ? { intent: ca.intent } : {}),
        ...(ca.action ? { action: ca.action } : {}),
      };
    } catch {
      // Unparseable click_action: leave it off the wire shape.
    }
  }

  return { validate_only: false, message: inner };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const huaweiAdapter: PushProvider = {
  /**
   * Mints a Huawei OAuth2 access token via client_credentials grant.
   *
   * Endpoint: https://oauth-login.cloud.huawei.com/oauth2/v3/token
   * Credentials map: client_id=secret.appId, client_secret=secret.appSecret
   */
  async mintToken(credential: ResolvedCredential): Promise<AccessToken> {
    const secret = credential.secret as HuaweiSecret;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: secret.appId,
      client_secret: secret.appSecret,
    });
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const errBody = (await resp.json()) as { error?: string; error_description?: string };
        if (errBody.error) detail += ` ${errBody.error}`;
        if (errBody.error_description) detail += `: ${errBody.error_description}`;
      } catch {
        // ignore parse failure; detail already contains the HTTP status
      }
      throw new Error(`Huawei OAuth token request failed (appId=${secret.appId}): ${detail}`);
    }
    const json = (await resp.json()) as { access_token?: string; expires_in: number };
    if (!json.access_token) {
      throw new Error(
        `Huawei OAuth response missing access_token (appId=${secret.appId}): ${JSON.stringify(json)}`,
      );
    }
    return { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  },

  render(message: NeutralMessage): WireMessage {
    return { provider: 'huawei', raw: buildRaw(message) };
  },

  /**
   * Sends a push notification to all recipients via the Huawei Push Kit REST API.
   *
   * Key behaviors:
   * - Obtains the access token via getAccessToken (shared token-cache), honoring
   *   the <5-min proactive-refresh SLA; does NOT mint a fresh token on every call.
   * - Chunks recipients into groups of ≤1000 (Huawei's per-request limit).
   * - HTTP 200 does NOT mean success — always parse body.code.
   * - Self-imposes QPS_PACE_MS between chunks (Huawei gives no Retry-After header).
   * - 80300010 (> 1000 tokens in a chunk): FIX_REQUEST, not RETRY_BACKOFF.
   */
  async send(
    credential: ResolvedCredential,
    message: WireMessage,
    recipients: Recipient[],
  ): Promise<DeliveryResult[]> {
    const accessToken = await getAccessToken(credential, (c) => huaweiAdapter.mintToken(c));
    const url = sendUrl(credential);
    const base = message.raw as { validate_only: boolean; message: Record<string, unknown> };
    const results: DeliveryResult[] = [];

    const chunks = chunk(recipients, CHUNK);
    for (let ci = 0; ci < chunks.length; ci += 1) {
      if (ci > 0) await sleep(QPS_PACE_MS);
      const group = chunks[ci];
      const payload = {
        validate_only: false,
        message: { ...base.message, token: group.map((r) => r.token) },
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = (await resp.json()) as {
        code: string;
        msg?: string;
        requestId?: string;
        illegal_tokens?: string[];
      };
      const mapped = mapHuaweiCode(body.code);
      const meta = { requestId: body.requestId };

      if (mapped === 'ok') {
        for (const r of group) {
          results.push({ token: r.token, deviceId: r.deviceId, status: 'sent', responseMeta: meta });
        }
      } else if (mapped === 'partial') {
        const bad = extractIllegalTokens(body);
        for (const r of group) {
          results.push(
            bad.has(r.token)
              ? {
                  token: r.token,
                  deviceId: r.deviceId,
                  status: 'invalid',
                  disposition: 'DELETE_TOKEN',
                  errorCode: body.code,
                }
              : { token: r.token, deviceId: r.deviceId, status: 'sent', responseMeta: meta },
          );
        }
      } else {
        for (const r of group) {
          results.push({
            token: r.token,
            deviceId: r.deviceId,
            status: mapped.status,
            disposition: mapped.disposition,
            errorCode: body.code,
          });
        }
      }
    }
    return results;
  },
};
