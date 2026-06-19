import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock crypto so the test never needs BO_MASTER_KEY.
// decryptSecret returns the JSON we encoded as the ciphertext field.
vi.mock('~~/server/utils/crypto', () => ({
  decryptSecret: (enc: { ciphertext: string }) => Buffer.from(enc.ciphertext, 'base64').toString('utf8'),
}));

// ---- In-memory DB mock for resolveCredential --------------------------------
// We keep a mutable array of rows and swap the `db.select()…where()` chain so
// it filters synchronously — no real Postgres connection required.
type FakeRow = {
  id: string;
  appId: string;
  provider: string;
  platform: string;
  label: string | null;
  secretCiphertext: string;
  secretNonce: string;
  secretTag: string;
  keyVersion: number;
  metaJsonb: Record<string, unknown>;
  configuredAt: Date;
  rotatedAt: Date | null;
};

let store: FakeRow[] = [];

vi.mock('~~/server/db/client', () => {
  // Minimal Drizzle-compatible query builder stub.
  const makeQuery = (rows: FakeRow[]) => ({
    from: () => ({
      where: (_cond: unknown) => {
        // The condition is opaque at this level; we let the real filter happen via
        // a closure over the predicate values injected by each test through `seed()`.
        // Because resolveCredential always does and(eq(appId), eq(provider)), we
        // resolve by re-executing against the mutable `store` array at await time.
        return Promise.resolve(rows);
      },
    }),
  });

  // We intercept at the module level by returning a proxy `db` that captures the
  // Drizzle `.select().from().where()` call and evaluates against `store` at resolve time.
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          // Evaluate the and(eq(appId,…), eq(provider,…)) condition by extracting
          // the SQL parameters from the Drizzle condition object's `values` list.
          // Drizzle's eq() builds a SQL template; we read the right-hand values.
          // The condition tree for and(eq(col,v1), eq(col,v2)) has:
          //   cond.sql → 'X.app_id = $1 and X.provider = $2'
          //   cond.values / queryChunks[n].value → the bound params
          // Instead of parsing the AST we use a simpler approach: replay the two
          // bound params in insertion order.
          const params = extractParams(cond);
          return Promise.resolve(store.filter((r) => {
            // params[0] = appId, params[1] = provider
            return r.appId === params[0] && r.provider === params[1];
          }));
        },
      }),
    }),
  };

  return { db };
});

// Recursively collect leaf `value` nodes from a Drizzle SQL chunk tree.
function extractParams(node: unknown): string[] {
  if (node == null || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  // Drizzle SQL value chunk: { value, encoder }
  if ('value' in n && 'encoder' in n) return [String(n.value)];
  // Drizzle AND: { sql: SQLWrapper[], … } or { queryChunks: [...] }
  const out: string[] = [];
  if (Array.isArray(n['queryChunks'])) {
    for (const chunk of n['queryChunks'] as unknown[]) out.push(...extractParams(chunk));
  }
  if (Array.isArray(n['sql'])) {
    for (const chunk of n['sql'] as unknown[]) out.push(...extractParams(chunk));
  }
  return out;
}

// ---- Import after mocks -------------------------------------------------------
import { isReady, resolveCredential } from './resolve';
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

function seedRow(row: Partial<Row> & { appId: string; provider: string; platform: string }) {
  store.push(baseRow(row) as unknown as FakeRow);
}

beforeEach(() => { store = []; });

// =============================================================================
// isReady
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
// resolveCredential
// =============================================================================
describe('resolveCredential', () => {
  const APP = '11111111-1111-1111-1111-111111111111';

  it('returns NOT_CONFIGURED when no row matches the provider', async () => {
    const r = await resolveCredential(APP, 'huawei', 'huawei');
    expect(r).toEqual({ ready: false, reason: 'NOT_CONFIGURED' });
  });

  it('matches the exact platform row and decrypts the secret', async () => {
    seedRow({
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
    seedRow({
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
    seedRow({
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
    // Insert both an 'any' and an exact 'android' row; the android row must win.
    seedRow({
      appId: APP,
      provider: 'fcm',
      platform: 'any',
      secretCiphertext: Buffer.from(JSON.stringify({ project_id: 'fallback' })).toString('base64'),
      metaJsonb: {},
    });
    seedRow({
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
