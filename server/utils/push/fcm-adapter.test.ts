import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEachForMulticast = vi.fn();
const getAccessToken = vi.fn();
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'test-app', options: { credential: { getAccessToken } } })),
  cert: vi.fn((x) => x),
  getApps: vi.fn(() => []),
  deleteApp: vi.fn(),
}));

import { fcmAdapter } from './fcm-adapter';
import type { NeutralMessage, ResolvedCredential, Recipient } from './types';

const cred: ResolvedCredential = {
  id: 'fcm-1', appId: 'app-1', provider: 'fcm', platform: 'android',
  secret: { project_id: 'p1', client_email: 'x@p1.iam', private_key: '-----PK-----' },
  meta: { project_id: 'p1' },
};

function msg(over: Partial<NeutralMessage> = {}): NeutralMessage {
  return { title: 'Hi', body: 'There', data: { k: 'v' }, mode: 'notification', priority: 'high', ...over };
}

describe('fcmAdapter.render', () => {
  it('notification mode includes a notification block', () => {
    const w = fcmAdapter.render(msg({ mode: 'notification' }));
    const raw = w.raw as any;
    expect(raw.notification).toEqual({ title: 'Hi', body: 'There' });
    expect(raw.data).toEqual({ k: 'v' });
  });

  it('data mode omits the notification block', () => {
    const w = fcmAdapter.render(msg({ mode: 'data' }));
    expect((w.raw as any).notification).toBeUndefined();
    expect((w.raw as any).data).toEqual({ k: 'v' });
  });

  it('priority high projects to android.priority=high and apns-priority=10', () => {
    const raw = fcmAdapter.render(msg({ priority: 'high' })).raw as any;
    expect(raw.android.priority).toBe('high');
    expect(raw.apns.headers['apns-priority']).toBe('10');
  });

  it('priority normal projects to android.priority=normal and apns-priority=5', () => {
    const raw = fcmAdapter.render(msg({ priority: 'normal' })).raw as any;
    expect(raw.android.priority).toBe('normal');
    expect(raw.apns.headers['apns-priority']).toBe('5');
  });
});

// FCM error shaped like firebase-admin's FirebaseMessagingError: code + optional httpResponse headers.
function fcmErr(code: string, headers?: Record<string, string>) {
  const error: any = Object.assign(new Error(code), { code });
  if (headers) {
    error.httpResponse = { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } };
  }
  return { success: false, error };
}
function fcmOk(id: string) {
  return { success: true, messageId: id };
}

const recips: Recipient[] = [
  { deviceId: 'd1', token: 't1', platform: 'android' },
  { deviceId: 'd2', token: 't2', platform: 'android' },
  { deviceId: 'd3', token: 't3', platform: 'ios' },
  { deviceId: 'd4', token: 't4', platform: 'android' },
];

describe('fcmAdapter.mintToken', () => {
  beforeEach(() => { getAccessToken.mockReset(); });

  it('returns an AccessToken{token,expiresAt} from the SA credential', async () => {
    getAccessToken.mockResolvedValueOnce({ access_token: 'AT-fcm', expires_in: 3600 });
    const tok = await fcmAdapter.mintToken(cred);
    expect(tok.token).toBe('AT-fcm');
    expect(tok.expiresAt).toBeGreaterThan(Date.now());
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('fcmAdapter.send', () => {
  beforeEach(() => { sendEachForMulticast.mockReset(); });

  it('normalizes success/UNREGISTERED/INTERNAL/THIRD_PARTY_AUTH_ERROR per token', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        fcmOk('m-1'),
        fcmErr('messaging/registration-token-not-registered'), // UNREGISTERED
        fcmErr('messaging/internal-error'),                     // 500 -> RETRY_BACKOFF
        fcmErr('messaging/third-party-auth-error'),             // 401 -> FIX_CREDENTIALS
      ],
    });
    const wire = fcmAdapter.render(msg());
    const out = await fcmAdapter.send(cred, wire, recips);

    expect(out[0]).toMatchObject({ token: 't1', status: 'sent', responseMeta: { messageId: 'm-1' } });
    expect(out[1]).toMatchObject({ token: 't2', status: 'invalid', disposition: 'DELETE_TOKEN' });
    expect(out[2]).toMatchObject({ token: 't3', status: 'failed', disposition: 'RETRY_BACKOFF' });
    expect(out[3]).toMatchObject({ token: 't4', status: 'failed', disposition: 'FIX_CREDENTIALS' });
  });

  it('maps INVALID_ARGUMENT to FIX_REQUEST/failed', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [fcmErr('messaging/invalid-argument')],
    });
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), [recips[0]]);
    expect(out[0]).toMatchObject({ token: 't1', status: 'failed', disposition: 'FIX_REQUEST' });
  });

  it('honors Retry-After on RETRY_BACKOFF by populating responseMeta.retryAfterMs', async () => {
    // Real SDK code: QUOTA_EXCEEDED → MESSAGE_RATE_EXCEEDED → 'messaging/message-rate-exceeded'
    // (confirmed from firebase-admin/lib/messaging/error.js; 'quota-exceeded' does not exist)
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [fcmErr('messaging/message-rate-exceeded', { 'retry-after': '30' })], // 30 seconds
    });
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), [recips[0]]);
    expect(out[0]).toMatchObject({ token: 't1', status: 'failed', disposition: 'RETRY_BACKOFF' });
    expect(out[0].responseMeta?.retryAfterMs).toBe(30_000);
  });

  it('also honors Retry-After for device-message-rate-exceeded', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [fcmErr('messaging/device-message-rate-exceeded', { 'retry-after': '60' })],
    });
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), [recips[0]]);
    expect(out[0]).toMatchObject({ token: 't1', status: 'failed', disposition: 'RETRY_BACKOFF' });
    expect(out[0].responseMeta?.retryAfterMs).toBe(60_000);
  });

  it('maps mismatched-credential (SENDER_ID_MISMATCH) to FIX_CREDENTIALS/failed — not retried', async () => {
    // SENDER_ID_MISMATCH / PERMISSION_DENIED → MISMATCHED_CREDENTIAL → 'messaging/mismatched-credential'
    // This is a config defect that never self-heals; must NOT be RETRY_BACKOFF.
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [fcmErr('messaging/mismatched-credential')],
    });
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), [recips[0]]);
    expect(out[0]).toMatchObject({ token: 't1', status: 'failed', disposition: 'FIX_CREDENTIALS' });
  });

  it('chunks recipients to <=500 per sendEachForMulticast call', async () => {
    sendEachForMulticast.mockImplementation(async (m: { tokens: string[] }) => ({
      responses: m.tokens.map((_t, i) => fcmOk(`m-${i}`)),
    }));
    const many: Recipient[] = Array.from({ length: 1100 }, (_v, i) => ({
      deviceId: `d${i}`, token: `t${i}`, platform: 'android' as const,
    }));
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), many);
    expect(out).toHaveLength(1100);
    expect(sendEachForMulticast).toHaveBeenCalledTimes(3); // 500 + 500 + 100
    const sizes = sendEachForMulticast.mock.calls.map((c) => (c[0] as { tokens: string[] }).tokens.length);
    expect(sizes).toEqual([500, 500, 100]);
  });

  it('caps concurrency at MAX_CONCURRENCY=100 chunks per outer-loop iteration', async () => {
    // 101 chunks of 500 = 50,500 recipients → outer loop fires i=0 (100 chunks) then i=100 (1 chunk).
    // We verify the second batch only runs after the first batch resolves by counting
    // concurrent in-flight calls.
    let maxConcurrent = 0;
    let inFlight = 0;
    sendEachForMulticast.mockImplementation(async (m: { tokens: string[] }) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      // Yield to let other microtasks queue, simulating async I/O overlap.
      await Promise.resolve();
      inFlight--;
      return { responses: m.tokens.map((_t, i) => fcmOk(`m-${i}`)) };
    });

    const TOTAL = 500 * 101; // 50,500 — forces two outer-loop iterations
    const many: Recipient[] = Array.from({ length: TOTAL }, (_v, i) => ({
      deviceId: `d${i}`, token: `t${i}`, platform: 'android' as const,
    }));
    const out = await fcmAdapter.send(cred, fcmAdapter.render(msg()), many);

    expect(out).toHaveLength(TOTAL);
    expect(sendEachForMulticast).toHaveBeenCalledTimes(101); // 100 + 1
    // Peak concurrency must never exceed MAX_CONCURRENCY (100).
    expect(maxConcurrent).toBeLessThanOrEqual(100);
    // And it should have reached at least 100 concurrent calls in the first batch.
    expect(maxConcurrent).toBeGreaterThanOrEqual(100);
  });
});
