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
    expect(df).toMatch(/pnpm install --frozen-lockfile/);
    expect(df).toMatch(/pnpm run build/);
  });

  it('runtime stage installs all deps from the frozen lockfile (no pnpm add)', () => {
    // Split on stage boundaries so we inspect only the runtime stage
    const stages = df.split(/^FROM\s/m);
    const runtimeStage = stages.find((s) => s.startsWith('node:') && s.includes('AS runtime'));
    expect(runtimeStage).toBeDefined();
    // Must use frozen-lockfile install (covers devDeps like tsx, drizzle-kit)
    expect(runtimeStage).toMatch(/pnpm install --frozen-lockfile/);
    // Must NOT use pnpm add (which would pull un-pinned versions and mutate the lockfile)
    expect(runtimeStage).not.toMatch(/pnpm add/);
  });

  it('uses the entrypoint script', () => {
    expect(df).toMatch(/entrypoint\.sh/);
  });
});
