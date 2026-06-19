/**
 * Integration test for POST /api/imports/credentials (multipart manifest + .json files).
 * Uses the M1 supertest harness (makeTestApp / resetDb / seedUser / authedFetch).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb, closeDb, db } from '~~/server/test/db';
import { seedUser, authedFetch } from '~~/server/test/auth';
import { appCredentials, companies, apps, auditLog } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

// Ensure master key for local/CI non-Docker runs.
process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';

let app: Awaited<ReturnType<typeof makeTestApp>>;
let auth: Awaited<ReturnType<typeof seedUser>>;
// `fetch` is the authenticated curried fetch returning parsed JSON.
let fetch: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;

const SA = JSON.stringify({
  project_id: 'proj-1',
  client_email: 'x@y.iam',
  private_key: '-----BEGIN-----SA_SENTINEL-----END-----',
});

/** Build a supertest multipart request against the node listener. */
async function multipartPost(
  csv: string,
  files: Record<string, string>,
  opts: { sessionCookie?: string; csrfCookie?: string; csrfToken?: string } = {},
) {
  const { default: request } = await import('supertest');
  let req = request(app.nodeListener)
    .post('/api/imports/credentials')
    .set('Origin', 'http://localhost:3000');

  if (opts.sessionCookie) {
    const cookies = [
      `bo_session=${opts.sessionCookie}`,
      opts.csrfCookie ? `bo_csrf=${opts.csrfCookie}` : '',
    ].filter(Boolean).join('; ');
    req = req.set('Cookie', cookies);
  }
  if (opts.csrfToken) req = req.set('x-csrf-token', opts.csrfToken);

  req = req.attach('manifest', Buffer.from(csv, 'utf-8'), { filename: 'manifest.csv', contentType: 'text/csv' });
  for (const [name, text] of Object.entries(files)) {
    req = req.attach(name, Buffer.from(text, 'utf-8'), { filename: name, contentType: 'application/json' });
  }

  return req;
}

/** Log in and retrieve session + CSRF cookies + token. */
async function loginAndGetCsrf() {
  const { default: request } = await import('supertest');
  const loginRes = await request(app.nodeListener)
    .post('/api/auth/login')
    .send({ email: auth.email, password: auth.plaintextPassword })
    .set('Content-Type', 'application/json');

  const extractCookie = (raw: string | string[] | undefined, name: string): string => {
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const cookie of cookies) {
      const first = (cookie.split(';')[0] ?? '').trim();
      if (first.startsWith(`${name}=`)) return first.slice(name.length + 1);
    }
    return '';
  };

  const sessionCookie = extractCookie(loginRes.headers['set-cookie'], 'bo_session');

  const csrfRes = await request(app.nodeListener)
    .get('/api/auth/csrf')
    .set('Cookie', `bo_session=${sessionCookie}`);

  const csrfCookie = extractCookie(csrfRes.headers['set-cookie'], 'bo_csrf');
  const csrfToken: string = (csrfRes.body as { token: string }).token ?? '';

  return { sessionCookie, csrfCookie, csrfToken };
}

beforeAll(async () => { app = await makeTestApp(); });
beforeEach(async () => {
  await resetDb();
  auth = await seedUser();
  fetch = authedFetch(app.nodeListener, auth);
});
afterAll(async () => { await closeDb(); });

describe('POST /api/imports/credentials', () => {
  it('imports a manifest + .json file, upserts company/app/credential, returns counts, audits credential_save', async () => {
    const csv = 'company,app,provider,platform,sa_json_file\nAcme,Shopper,fcm,android,acme.json\n';
    const { sessionCookie, csrfCookie, csrfToken } = await loginAndGetCsrf();

    const res = await multipartPost(csv, { 'acme.json': SA }, { sessionCookie, csrfCookie, csrfToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, updated: 0, failed: 0, errors: [] });

    const [company] = await db.select().from(companies).where(eq(companies.name, 'Acme'));
    expect(company).toBeTruthy();
    const [cred] = await db.select().from(appCredentials);
    expect(cred.secretCiphertext).not.toContain('SA_SENTINEL');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'credential_save'));
    expect(audits).toHaveLength(1);
  });

  it('reports bad rows in errors[] without partial writes', async () => {
    const csv = 'company,app,provider,platform,sa_json_file\nAcme,Shopper,fcm,android,absent.json\n';
    const { sessionCookie, csrfCookie, csrfToken } = await loginAndGetCsrf();

    const res = await multipartPost(csv, {}, { sessionCookie, csrfCookie, csrfToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, failed: 1, errors: [{ rowNumber: 1, reason: 'SA_FILE_MISSING' }] });
    expect(await db.select().from(appCredentials)).toHaveLength(0);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const csv = 'company\nAcme\n';
    const res = await multipartPost(csv, {});
    expect(res.status).toBe(401);
  });

  it('rejects a missing CSRF token with 403', async () => {
    const { sessionCookie, csrfCookie } = await loginAndGetCsrf();
    // Provide session but omit CSRF token.
    const csv = 'company\nAcme\n';
    const res = await multipartPost(csv, {}, { sessionCookie, csrfCookie });   // no csrfToken
    expect(res.status).toBe(403);
  });
});
