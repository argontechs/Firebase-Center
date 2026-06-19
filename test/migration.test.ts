import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const migDir = `${root}server/db/migrations`;

describe('initial migration', () => {
  it('a versioned SQL migration exists with a journal', () => {
    expect(existsSync(migDir)).toBe(true);
    const sqls = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
    expect(sqls.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(`${migDir}/meta/_journal.json`)).toBe(true);
  });

  it('the migration creates the core tables and enums', () => {
    const sqls = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
    const all = sqls.map((f) => readFileSync(`${migDir}/${f}`, 'utf8')).join('\n');
    for (const tbl of ['users', 'companies', 'apps', 'app_credentials', 'devices', 'campaigns', 'deliveries', 'jobs', 'audit_log']) {
      expect(all).toMatch(new RegExp(`CREATE TABLE[^;]*"${tbl}"`, 'i'));
    }
    expect(all).toMatch(/CREATE TYPE[^;]*"provider"/i);
    expect(all).toMatch(/CREATE TYPE[^;]*"target_type"/i);
  });
});
