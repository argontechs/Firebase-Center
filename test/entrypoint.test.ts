import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sh = readFileSync(`${root}entrypoint.sh`, 'utf8');

describe('entrypoint.sh', () => {
  it('enforces wait-for-db -> migrate -> seed -> serve ordering', () => {
    const iWait = sh.indexOf('pg_isready');
    const iMigrate = sh.search(/db:migrate|migrate\.ts/);
    const iSeed = sh.search(/db:seed|seed\.ts/);
    const iServe = sh.search(/\.output\/server\/index\.mjs/);
    expect(iWait).toBeGreaterThanOrEqual(0);
    expect(iMigrate).toBeGreaterThan(iWait);
    expect(iSeed).toBeGreaterThan(iMigrate);
    expect(iServe).toBeGreaterThan(iSeed);
  });

  it('fails fast on errors (set -e)', () => {
    expect(sh).toMatch(/set -e/);
  });
});
