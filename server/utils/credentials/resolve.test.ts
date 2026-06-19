/**
 * resolve.test.ts
 *
 * Test DB: pg-mem (in-memory Postgres).  A Drizzle pg instance is built over
 * pg-mem and the app_credentials table is created before the first test runs.
 * This exercises real SQL (real WHERE/AND/EQ evaluation) instead of the
 * hand-rolled Drizzle-AST-parsing stub that the spec explicitly rejected.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// pg-mem compat layer
// ---------------------------------------------------------------------------
/**
 * Drizzle's node-postgres driver passes `types: { getTypeParser }` and
 * `rowMode: 'array'` in every query config object.  pg-mem v3 rejects both.
 * This factory returns a Pool-compatible proxy that:
 *  1. strips `types` and `rowMode` before forwarding to pg-mem, and
 *  2. when `rowMode` was `'array'`, converts the keyed-object rows pg-mem
 *     returns back to the positional arrays Drizzle's mapResultRow expects.
 */
function makePgMemCompatPool(raw: { query: Function }) {
  function extractSelectColumns(sql: string): string[] {
    const m = sql.match(/^select (.+?) from /i);
    if (!m) return [];
    return m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  }

  return new Proxy(raw, {
    get(target, prop) {
      if (prop !== 'query') return Reflect.get(target, prop);
      return async function (queryOrText: unknown, params?: unknown[]) {
        let originalRowMode: string | null = null;
        let sqlText = '';
        let q: unknown = queryOrText;
        if (q && typeof q === 'object') {
          const { types: _types, rowMode, ...rest } = q as Record<string, unknown>;
          originalRowMode = (rowMode as string) ?? null;
          sqlText = (rest.text as string) ?? '';
          q = rest;
        }
        const result = await (target as { query: Function }).query(q, params);
        if (originalRowMode === 'array' && result && Array.isArray(result.rows)) {
          const cols = extractSelectColumns(sqlText);
          result.rows = (result.rows as unknown[]).map((row) => {
            if (Array.isArray(row)) return row;
            const r = row as Record<string, unknown>;
            return cols.map((col) => {
              const v = r[col];
              // pg-mem returns jsonb columns as JSON strings — parse them so
              // Drizzle receives proper objects.
              if (col.includes('json') && typeof v === 'string') {
                try { return JSON.parse(v); } catch { return v; }
              }
              return v;
            });
          });
        }
        return result;
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Shared pg-mem state — populated by setupPgMem(), called from beforeAll.
// We use var so declarations are hoisted past the temporal-dead-zone issues
// that vi.mock's factory hoisting creates with let/const.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-var
var _rawPool: { query: Function } | null = null;
// eslint-disable-next-line no-var
var _memDb: unknown = null;

async function setupPgMem() {
  if (_memDb) return; // already initialised

  const { newDb } = await import('pg-mem');
  const { drizzle } = await import('drizzle-orm/node-postgres');

  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const raw = new Pool();
  _rawPool = raw;

  const compatPool = makePgMemCompatPool(raw);

  // DDL: only the columns resolve.ts queries.
  // Note: we omit DEFAULT gen_random_uuid() because pg-mem v3 evaluates DEFAULT
  // expressions once and caches the result, causing duplicate-key errors when
  // multiple rows are inserted.  Instead, seed() provides explicit UUIDs.
  await raw.query(`CREATE TYPE provider     AS ENUM ('fcm','huawei')`);
  await raw.query(`CREATE TYPE cred_platform AS ENUM ('ios','android','huawei','web','any')`);
  await raw.query(`
    CREATE TABLE app_credentials (
      id                uuid          PRIMARY KEY,
      app_id            uuid          NOT NULL,
      provider          provider      NOT NULL,
      platform          cred_platform NOT NULL,
      label             text,
      secret_ciphertext text          NOT NULL,
      secret_nonce      text          NOT NULL,
      secret_tag        text          NOT NULL,
      key_version       integer       NOT NULL DEFAULT 1,
      meta_jsonb        jsonb         NOT NULL DEFAULT '{}',
      configured_at     timestamptz   NOT NULL DEFAULT now(),
      rotated_at        timestamptz
    )
  `);

  _memDb = drizzle(compatPool as unknown as Parameters<typeof drizzle>[0]);
}

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports of the mocked modules.
// Using vi.doMock (not vi.mock) so the factory is NOT hoisted; we can safely
// reference _memDb here because the factory runs lazily at the first import.
// We then use dynamic import for the modules under test.
// ---------------------------------------------------------------------------
vi.doMock('~~/server/utils/crypto', () => ({
  decryptSecret: (enc: { ciphertext: string }) =>
    Buffer.from(enc.ciphertext, 'base64').toString('utf8'),
}));

vi.doMock('~~/server/db/client', async () => {
  await setupPgMem();
  return { db: _memDb };
});

// ---------------------------------------------------------------------------
// Lazily imported module under test (after doMock registrations).
// ---------------------------------------------------------------------------
let isReady: (row: unknown) => boolean;
let resolveCredential: (
  appId: string,
  provider: 'fcm' | 'huawei',
  platform: string,
) => Promise<
  | { ready: true; credential: { provider: string; platform: string; secret: unknown; meta: unknown } }
  | { ready: false; reason: string }
>;

beforeAll(async () => {
  await setupPgMem();
  // Dynamic import picks up the doMock registrations above.
  const mod = await import('./resolve');
  isReady = mod.isReady as typeof isReady;
  resolveCredential = mod.resolveCredential as typeof resolveCredential;
});

beforeEach(async () => {
  if (_rawPool) await _rawPool.query('DELETE FROM app_credentials');
});

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
import type { appCredentials } from '~~/server/db/schema';
type Row = typeof appCredentials.$inferSelect;

function baseRow(over: Partial<Row>): Row {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    appId: 'app-1',
    provider: 'fcm',
    platform: 'android',
    label: null,
    secretCiphertext: Buffer.from('{}').toString('base64'),
    secretNonce: 'AA==',
    secretTag:   'AA==',
    keyVersion: 1,
    metaJsonb:  {},
    configuredAt: new Date(),
    rotatedAt:  null,
    ...over,
  } as Row;
}

/** Insert a credential row directly via raw SQL (no Drizzle foreign-key refs needed). */
async function seed(over: {
  appId: string;
  provider: string;
  platform: string;
  secretCiphertext?: string;
  metaJsonb?: Record<string, unknown>;
}) {
  if (!_rawPool) throw new Error('pg-mem not initialised');
  // Provide an explicit id: pg-mem v3 caches DEFAULT expression results across
  // inserts, so DEFAULT gen_random_uuid() would produce duplicate PKs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const id = require('crypto').randomUUID() as string;
  const enc = over.secretCiphertext ?? Buffer.from('{}').toString('base64');
  const meta = JSON.stringify(over.metaJsonb ?? {});
  await _rawPool.query(
    `INSERT INTO app_credentials
       (id, app_id, provider, platform, secret_ciphertext, secret_nonce, secret_tag, meta_jsonb)
     VALUES ($1, $2, $3, $4, $5, 'AA==', 'AA==', $6)`,
    [id, over.appId, over.provider, over.platform, enc, meta],
  );
}

// =============================================================================
// isReady — pure function, no DB
// =============================================================================
describe('isReady', () => {
  it('FCM android: ready when row exists (SA JSON alone authorizes sending)', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'android' }))).toBe(true);
  });

  it('FCM any: ready when row exists', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'any' }))).toBe(true);
  });

  it('FCM ios: NOT ready without apns_p8_uploaded readiness flag', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'ios', metaJsonb: {} }))).toBe(false);
  });

  it('FCM ios: ready when meta.apns_p8_uploaded is true', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'ios', metaJsonb: { apns_p8_uploaded: true } }))).toBe(true);
  });

  it('FCM web: NOT ready without vapid_present readiness flag', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'web', metaJsonb: {} }))).toBe(false);
  });

  it('FCM web: ready when meta.vapid_present is true', () => {
    expect(isReady(baseRow({ provider: 'fcm', platform: 'web', metaJsonb: { vapid_present: true } }))).toBe(true);
  });

  it('Huawei: NOT ready without push_kit_enabled', () => {
    expect(isReady(baseRow({ provider: 'huawei', platform: 'huawei', metaJsonb: {} }))).toBe(false);
  });

  it('Huawei: ready when meta.push_kit_enabled is true', () => {
    expect(isReady(baseRow({ provider: 'huawei', platform: 'huawei', metaJsonb: { push_kit_enabled: true } }))).toBe(true);
  });
});

// =============================================================================
// resolveCredential — exercises real SQL via pg-mem
// =============================================================================
describe('resolveCredential', () => {
  const APP = '11111111-1111-1111-1111-111111111111';

  it('returns NOT_CONFIGURED when no row matches the provider', async () => {
    const r = await resolveCredential(APP, 'huawei', 'huawei');
    expect(r).toEqual({ ready: false, reason: 'NOT_CONFIGURED' });
  });

  it('matches the exact platform row and decrypts the secret', async () => {
    await seed({
      appId: APP,
      provider: 'fcm',
      platform: 'android',
      secretCiphertext: Buffer.from(JSON.stringify({ project_id: 'p1' })).toString('base64'),
      metaJsonb: {},
    });
    const r = await resolveCredential(APP, 'fcm', 'android');
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.credential.provider).toBe('fcm');
      expect(r.credential.platform).toBe('android');
      expect((r.credential.secret as { project_id: string }).project_id).toBe('p1');
    }
  });

  it("falls back to platform='any' row and exposes Huawei secret shape + meta", async () => {
    await seed({
      appId: APP,
      provider: 'huawei',
      platform: 'any',
      secretCiphertext: Buffer.from(JSON.stringify({ appId: '900', appSecret: 'SEC' })).toString('base64'),
      metaJsonb: { push_kit_enabled: true, project_id: 'proj-7' },
    });
    const r = await resolveCredential(APP, 'huawei', 'huawei');
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.credential.platform).toBe('any');
      expect((r.credential.secret as { appId: string; appSecret: string }).appId).toBe('900');
      expect((r.credential.secret as { appId: string; appSecret: string }).appSecret).toBe('SEC');
      // meta.project_id (non-secret) drives v2 URL selection in the Huawei adapter (M5.5)
      expect((r.credential.meta as { project_id?: string }).project_id).toBe('proj-7');
    }
  });

  it('returns NOT_READY when the matching row is not ready (FCM ios without apns flag)', async () => {
    await seed({
      appId: APP,
      provider: 'fcm',
      platform: 'ios',
      secretCiphertext: Buffer.from('{}').toString('base64'),
      metaJsonb: {},
    });
    const r = await resolveCredential(APP, 'fcm', 'ios');
    expect(r).toEqual({ ready: false, reason: 'NOT_READY' });
  });

  it('prefers exact platform match over any-platform fallback', async () => {
    await seed({
      appId: APP,
      provider: 'fcm',
      platform: 'any',
      secretCiphertext: Buffer.from(JSON.stringify({ project_id: 'fallback' })).toString('base64'),
      metaJsonb: {},
    });
    await seed({
      appId: APP,
      provider: 'fcm',
      platform: 'android',
      secretCiphertext: Buffer.from(JSON.stringify({ project_id: 'exact' })).toString('base64'),
      metaJsonb: {},
    });
    const r = await resolveCredential(APP, 'fcm', 'android');
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect((r.credential.secret as { project_id: string }).project_id).toBe('exact');
    }
  });
});
