import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('Dockerfile', () => {
  const df = readFileSync(`${root}Dockerfile`, 'utf8');

  it('pins the base image to an exact version (no :latest)', () => {
    const froms = [...df.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThanOrEqual(2); // multi-stage
    for (const img of froms) {
      const base = img.split(' AS ')[0];
      if (base.includes('node')) {
        expect(base).toMatch(/node:\d+\.\d+\.\d+/); // exact version, not :latest
      }
    }
  });

  it('installs from the lockfile and builds', () => {
    expect(df).toMatch(/npm ci/);
    expect(df).toMatch(/npm run build/);
  });

  it('uses the entrypoint script', () => {
    expect(df).toMatch(/entrypoint\.sh/);
  });
});
