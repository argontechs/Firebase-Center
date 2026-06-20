import { createServer } from 'node:http';

/**
 * Starts a minimal in-process mock HTTP server that answers:
 *   - OAuth token mints (FCM google-auth + Huawei client_credentials)
 *   - FCM HTTP v1 message send
 *   - Huawei Push Kit v1/v2 message send
 *
 * All responses use the real wire shapes so the adapters parse them correctly.
 * No real provider credentials are required.
 */
export async function startMockProviders() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');

      // OAuth token mint — both FCM (google-auth-library) and Huawei (client_credentials)
      // post to a /token endpoint.
      if (req.url?.includes('/token') || req.url?.endsWith('/oauth2/v3/token')) {
        res.end(
          JSON.stringify({
            access_token: 'mock-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
        return;
      }

      // FCM HTTP v1: POST /v1/projects/{project_id}/messages:send
      // Huawei v1:   POST /v1/{app_id}/messages:send
      // Huawei v2:   POST /v2/{project_id}/messages:send
      if (req.url?.includes('/messages:send')) {
        if (req.url.includes('/v1/projects/')) {
          // FCM HTTP v1 success shape
          res.end(JSON.stringify({ name: 'projects/mock/messages/mock-msg-id' }));
        } else {
          // Huawei success shape (both v1 and v2)
          res.end(
            JSON.stringify({
              code: '80000000',
              msg: 'Success',
              requestId: 'mock-req',
            }),
          );
        }
        return;
      }

      res.statusCode = 404;
      res.end('{}');
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  return {
    fcmUrl: base,
    huaweiUrl: base,
    oauthUrl: `${base}/token`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
