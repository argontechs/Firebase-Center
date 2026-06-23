import { describe, it, expect } from 'vitest';
import { parseImport } from '../../../server/utils/import/parse';

const mapping = { token: 'tok', provider: 'prov', platform: 'plat', externalUserId: 'uid' };

describe('parseImport CSV', () => {
  it('maps explicit columns to ParsedRow with 1-based rowNumber', () => {
    const csv = 'tok,prov,plat,uid\nabc,fcm,android,u1\ndef,huawei,huawei,u2\n';
    const rows = parseImport(csv, 'csv', mapping, {});
    expect(rows).toEqual([
      { rowNumber: 1, token: 'abc', provider: 'fcm', platform: 'android', externalUserId: 'u1', tags: [], attributes: {} },
      { rowNumber: 2, token: 'def', provider: 'huawei', platform: 'huawei', externalUserId: 'u2', tags: [], attributes: {} },
    ]);
  });
});

describe('parseImport defaults & JSON', () => {
  it('applies per-import default provider/platform when column absent', () => {
    const csv = 'tok\nabc\n';
    const rows = parseImport(csv, 'csv', { token: 'tok' }, { provider: 'fcm', platform: 'android' });
    expect(rows[0].provider).toBe('fcm');
    expect(rows[0].platform).toBe('android');
  });

  it('applies default when cell is empty, but keeps explicit cell value', () => {
    const csv = 'tok,prov\nabc,\ndef,huawei\n';
    const rows = parseImport(csv, 'csv', { token: 'tok', provider: 'prov' }, { provider: 'fcm' });
    expect(rows[0].provider).toBe('fcm');     // empty cell -> default
    expect(rows[1].provider).toBe('huawei');  // explicit wins
  });

  it('parses a JSON array and folds attributes columns', () => {
    const json = JSON.stringify([{ tok: 'abc', prov: 'fcm', plat: 'ios', country: 'MY', app_version: '1.2' }]);
    const rows = parseImport(json, 'json', { token: 'tok', provider: 'prov', platform: 'plat', attributes: ['country', 'app_version'] }, {});
    expect(rows[0]).toEqual({
      rowNumber: 1, token: 'abc', provider: 'fcm', platform: 'ios', externalUserId: null,
      tags: [],
      attributes: { country: 'MY', app_version: '1.2' },
    });
  });
});
