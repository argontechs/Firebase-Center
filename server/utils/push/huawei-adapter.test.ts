import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { huaweiAdapter } from './huawei-adapter';
import type { NeutralMessage, ResolvedCredential, Recipient } from './types';

function msg(over: Partial<NeutralMessage> = {}): NeutralMessage {
  return { title: 'Hi', body: 'There', data: { k: 'v' }, mode: 'notification', priority: 'high', ...over };
}

describe('huaweiAdapter.render', () => {
  it('serializes data to a JSON string (not a map)', () => {
    const raw = huaweiAdapter.render(msg({ data: { a: '1', b: '2' } })).raw as any;
    expect(typeof raw.message.data).toBe('string');
    expect(JSON.parse(raw.message.data)).toEqual({ a: '1', b: '2' });
  });

  it('notification mode includes a notification block', () => {
    const raw = huaweiAdapter.render(msg({ mode: 'notification' })).raw as any;
    expect(raw.message.notification).toEqual({ title: 'Hi', body: 'There' });
  });

  it('data mode omits the notification block', () => {
    const raw = huaweiAdapter.render(msg({ mode: 'data' })).raw as any;
    expect(raw.message.notification).toBeUndefined();
  });

  it('priority high projects urgency=HIGH + importance=HIGH', () => {
    const raw = huaweiAdapter.render(msg({ priority: 'high' })).raw as any;
    expect(raw.message.android.urgency).toBe('HIGH');
    expect(raw.message.android.notification.importance).toBe('HIGH');
    expect(raw.message.android.category).toBeDefined();
  });

  it('priority normal projects urgency=NORMAL + importance=NORMAL', () => {
    const raw = huaweiAdapter.render(msg({ priority: 'normal' })).raw as any;
    expect(raw.message.android.urgency).toBe('NORMAL');
    expect(raw.message.android.notification.importance).toBe('NORMAL');
  });

  it('throws on a type:1 click_action with neither intent nor action (defense-in-depth)', () => {
    const m = msg({ data: { click_action: JSON.stringify({ type: '1' }) } });
    expect(() => huaweiAdapter.render(m)).toThrowError(/click_action/i);
  });

  it('projects a valid type:1 click_action (action set) into android.notification.click_action', () => {
    const m = msg({ data: { click_action: JSON.stringify({ type: 1, action: 'com.acme.OPEN_DETAIL' }) } });
    const raw = huaweiAdapter.render(m).raw as any;
    expect(raw.message.android.notification.click_action).toMatchObject({ type: 1, action: 'com.acme.OPEN_DETAIL' });
  });
});

const fcred = (over: Partial<ResolvedCredential> = {}): ResolvedCredential => ({
  id: 'hw-1', appId: 'app-1', provider: 'huawei', platform: 'huawei',
  secret: { appId: '900', appSecret: 'SEC' }, meta: {}, ...over,
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  } as unknown as Response);
}

const recips: Recipient[] = [
  { deviceId: 'd1', token: 't1', platform: 'huawei' },
  { deviceId: 'd2', token: 't2', platform: 'huawei' },
];

describe('huaweiAdapter.mintToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs client_credentials form to the oauth-login host using the pinned secret shape', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600 }));
    const tok = await huaweiAdapter.mintToken(fcred());
    expect(tok.token).toBe('AT');
    expect(tok.expiresAt).toBeGreaterThan(Date.now());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth-login.cloud.huawei.com/oauth2/v3/token');
    expect(String(init.body)).toContain('grant_type=client_credentials');
    expect(String(init.body)).toContain('client_id=900');     // secret.appId
    expect(String(init.body)).toContain('client_secret=SEC');  // secret.appSecret
  });

  it('throws a readable error when the OAuth endpoint returns HTTP 401 (wrong credentials)', async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ error: 'invalid_client', error_description: 'Bad App ID or Secret' }, 401),
    );
    await expect(huaweiAdapter.mintToken(fcred())).rejects.toThrow(/Huawei OAuth token request failed.*HTTP 401.*invalid_client/i);
  });

  it('throws a readable error when the OAuth endpoint returns HTTP 400', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ error: 'invalid_request' }, 400));
    await expect(huaweiAdapter.mintToken(fcred())).rejects.toThrow(/HTTP 400/);
  });

  it('throws when access_token is absent from a 200 response', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ token_type: 'Bearer', expires_in: 3600 }));
    await expect(huaweiAdapter.mintToken(fcred())).rejects.toThrow(/missing access_token/i);
  });
});

describe('huaweiAdapter.send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // token mint first, then send calls
    fetchMock.mockReturnValueOnce(jsonResponse({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the v1 app-scoped URL when no project_id', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'Success', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    const sendUrl = fetchMock.mock.calls[1][0];
    expect(sendUrl).toBe('https://push-api.cloud.huawei.com/v1/900/messages:send');
    expect(out.every((r) => r.status === 'sent')).toBe(true);
  });

  it('uses the v2 project-scoped URL when meta.project_id present', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'ok', requestId: 'r2' }));
    await huaweiAdapter.send(
      fcred({ meta: { project_id: 'proj-7' } }),
      huaweiAdapter.render(msg()),
      recips,
    );
    expect(fetchMock.mock.calls[1][0]).toBe('https://push-api.cloud.huawei.com/v2/proj-7/messages:send');
  });

  it('parses body code on HTTP 200 success (80000000 -> all sent)', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'Success', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out).toEqual([
      { token: 't1', deviceId: 'd1', status: 'sent', responseMeta: { requestId: 'r1' } },
      { token: 't2', deviceId: 'd2', status: 'sent', responseMeta: { requestId: 'r1' } },
    ]);
  });

  it('prunes illegal_tokens on partial success 80100000', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({
      code: '80100000', msg: 'partial', requestId: 'r1',
      // Huawei returns illegal_tokens as a JSON string in msg; adapter parses the listed tokens
      illegal_tokens: ['t2'],
    }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out[0]).toMatchObject({ token: 't1', status: 'sent' });
    expect(out[1]).toMatchObject({ token: 't2', status: 'invalid', disposition: 'DELETE_TOKEN' });
  });

  it('marks ALL invalid on 80300007', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80300007', msg: 'all invalid', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.status === 'invalid' && r.disposition === 'DELETE_TOKEN')).toBe(true);
  });

  it('marks ALL invalid on 80300002', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80300002', msg: 'all invalid', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.disposition === 'DELETE_TOKEN')).toBe(true);
  });

  it('maps 80200001 to REAUTH/failed', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80200001', msg: 'auth', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.status === 'failed' && r.disposition === 'REAUTH')).toBe(true);
  });

  it('maps 81000001 to RETRY_BACKOFF/failed', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '81000001', msg: 'internal', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.disposition === 'RETRY_BACKOFF')).toBe(true);
  });

  it('maps 80300008 (oversize payload) to FIX_REQUEST/failed', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80300008', msg: 'too large', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.disposition === 'FIX_REQUEST')).toBe(true);
  });

  it('maps 80100003 (click_action.type:1 structure error) to FIX_REQUEST/failed', async () => {
    // Re-stub mint for this test (beforeEach already consumed the first mock slot).
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80100003', msg: 'invalid click_action', requestId: 'r2' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.status === 'failed' && r.disposition === 'FIX_REQUEST')).toBe(true);
  });

  it('maps 80300010 (token count > 1000) to FIX_REQUEST/failed, NOT RETRY_BACKOFF', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ code: '80300010', msg: 'too many tokens', requestId: 'r1' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), recips);
    expect(out.every((r) => r.status === 'failed' && r.disposition === 'FIX_REQUEST')).toBe(true);
  });

  it('chunks tokens to <=1000 per request', async () => {
    const many: Recipient[] = Array.from({ length: 2500 }, (_v, i) => ({
      deviceId: `d${i}`, token: `t${i}`, platform: 'huawei' as const,
    }));
    fetchMock
      .mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'ok', requestId: 'a' }))
      .mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'ok', requestId: 'b' }))
      .mockReturnValueOnce(jsonResponse({ code: '80000000', msg: 'ok', requestId: 'c' }));
    const out = await huaweiAdapter.send(fcred(), huaweiAdapter.render(msg()), many);
    expect(out).toHaveLength(2500);
    // 1 mint + 3 send calls (1000 + 1000 + 500)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const sendBodies = fetchMock.mock.calls.slice(1).map((c) => JSON.parse(String((c[1] as RequestInit).body)).message.token.length);
    expect(sendBodies).toEqual([1000, 1000, 500]);
  });
});
