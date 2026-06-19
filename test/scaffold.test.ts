import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('scaffold', () => {
  it('package.json declares the required scripts', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
    for (const s of ['dev', 'build', 'test', 'db:generate', 'db:migrate', 'db:seed']) {
      expect(pkg.scripts[s], `script "${s}" missing`).toBeTruthy();
    }
  });

  it('nuxt.config exists and keeps secrets server-only (no public secret keys)', () => {
    expect(existsSync(`${root}nuxt.config.ts`)).toBe(true);
    const cfg = readFileSync(`${root}nuxt.config.ts`, 'utf8');
    // runtimeConfig present; databaseUrl / boMasterKey / sessionPassword are NOT under public
    expect(cfg).toMatch(/runtimeConfig/);
    const publicBlock = cfg.slice(cfg.indexOf('public:'));
    expect(publicBlock).not.toMatch(/boMasterKey/);
    expect(publicBlock).not.toMatch(/databaseUrl/);
    expect(publicBlock).not.toMatch(/sessionPassword/);
  });
});
