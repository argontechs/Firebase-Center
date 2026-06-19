import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast }) }));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ options: { credential: {} } })),
  cert: vi.fn((x) => x),
  getApps: vi.fn(() => []),
  deleteApp: vi.fn(),
}));

import { fcmAdapter } from './fcm-adapter';
import { huaweiAdapter } from './huawei-adapter';
import type { NeutralMessage, Recipient, ResolvedCredential, DeliveryResult } from './types';

const NEUTRAL: NeutralMessage = {
  title: 'Hi', body: 'There', data: { k: 'v' }, mode: 'notification', priority: 'high',
};
const fcmCred: ResolvedCredential = {
  id: 'f1', appId: 'a', provider: 'fcm', platform: 'android',
  secret: { project_id: 'p1' }, meta: { project_id: 'p1' },
};
const hwCred: ResolvedCredential = {
  id: 'h1', appId: 'a', provider: 'huawei', platform: 'huawei',
  secret: { appId: '900', appSecret: 'S' }, meta: {},
};
const two: Recipient[] = [
  { deviceId: 'd1', token: 't1', platform: 'android' },
  { deviceId: 'd2', token: 't2', platform: 'android' },
];

function hwResponse(body: unknown) {
  return Promise.resolve({ status: 200, ok: true, json: async () => body } as unknown as Response);
}

describe('adapter parity: every non-sent result carries a disposition', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sendEachForMulticast.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function assertNonSentHaveDisposition(results: DeliveryResult[]) {
    for (const r of results) {
      if (r.status !== 'sent') expect(r.disposition).toBeDefined();
      if (r.status === 'invalid') expect(r.disposition).toBe('DELETE_TOKEN');
    }
  }

  it('FCM: success/all-invalid/oversize/throttle all yield typed dispositions', async () => {
    sendEachForMulticast
      .mockResolvedValueOnce({ responses: [{ success: true, messageId: 'm1' }, { success: true, messageId: 'm2' }] })
      .mockResolvedValueOnce({ responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ] })
      .mockResolvedValueOnce({ responses: [
        { success: false, error: { code: 'messaging/payload-size-limit-exceeded' } },
        { success: false, error: { code: 'messaging/payload-size-limit-exceeded' } },
      ] })
      .mockResolvedValueOnce({ responses: [
        { success: false, error: { code: 'messaging/quota-exceeded' } },
        { success: false, error: { code: 'messaging/quota-exceeded' } },
      ] });
    const wire = fcmAdapter.render(NEUTRAL);
    assertNonSentHaveDisposition(await fcmAdapter.send(fcmCred, wire, two)); // sent
    const inv = await fcmAdapter.send(fcmCred, wire, two);
    expect(inv.every((r) => r.disposition === 'DELETE_TOKEN')).toBe(true);
    const oversize = await fcmAdapter.send(fcmCred, wire, two);
    expect(oversize.every((r) => r.disposition === 'FIX_REQUEST')).toBe(true);
    const throttle = await fcmAdapter.send(fcmCred, wire, two);
    expect(throttle.every((r) => r.disposition === 'RETRY_BACKOFF')).toBe(true);
  });

  it('Huawei: success/all-invalid/oversize/reauth/throttle all yield typed dispositions', async () => {
    const cases: Array<[unknown, (r: DeliveryResult[]) => void]> = [
      [{ code: '80000000', requestId: 'r' }, (r) => expect(r.every((x) => x.status === 'sent')).toBe(true)],
      [{ code: '80300007', requestId: 'r' }, (r) => expect(r.every((x) => x.disposition === 'DELETE_TOKEN')).toBe(true)],
      [{ code: '80300008', requestId: 'r' }, (r) => expect(r.every((x) => x.disposition === 'FIX_REQUEST')).toBe(true)],
      [{ code: '80200001', requestId: 'r' }, (r) => expect(r.every((x) => x.disposition === 'REAUTH')).toBe(true)],
      [{ code: '81000001', requestId: 'r' }, (r) => expect(r.every((x) => x.disposition === 'RETRY_BACKOFF')).toBe(true)],
    ];
    const wire = huaweiAdapter.render(NEUTRAL);
    for (const [body, assertFn] of cases) {
      fetchMock.mockReset();
      fetchMock
        .mockReturnValueOnce(hwResponse({ access_token: 'AT', expires_in: 3600 }))
        .mockReturnValueOnce(hwResponse(body));
      const out = await huaweiAdapter.send(hwCred, wire, two);
      assertNonSentHaveDisposition(out);
      assertFn(out);
    }
  });

  it('both adapters draw dispositions from the same Disposition union', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [{ success: false, error: { code: 'messaging/internal-error' } }, { success: false, error: { code: 'messaging/internal-error' } }],
    });
    fetchMock
      .mockReturnValueOnce(hwResponse({ access_token: 'AT', expires_in: 3600 }))
      .mockReturnValueOnce(hwResponse({ code: '81000001', requestId: 'r' }));
    const fcm = await fcmAdapter.send(fcmCred, fcmAdapter.render(NEUTRAL), two);
    const hw = await huaweiAdapter.send(hwCred, huaweiAdapter.render(NEUTRAL), two);
    const allowed = new Set(['DELETE_TOKEN', 'RETRY_BACKOFF', 'FIX_REQUEST', 'REAUTH', 'FIX_CREDENTIALS', 'CREDENTIAL_NOT_READY']);
    for (const r of [...fcm, ...hw]) {
      if (r.disposition) expect(allowed.has(r.disposition)).toBe(true);
    }
    expect(fcm[0].disposition).toBe('RETRY_BACKOFF');
    expect(hw[0].disposition).toBe('RETRY_BACKOFF');
  });
});
