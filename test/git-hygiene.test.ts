import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('git hygiene', () => {
  it('.gitignore excludes env and build artifacts', () => {
    const ig = readFileSync(`${root}.gitignore`, 'utf8');
    for (const p of ['.env', 'node_modules', '.nuxt', '.output']) {
      expect(ig.split(/\r?\n/)).toContain(p);
    }
  });

  it('.gitattributes forces LF for shell scripts', () => {
    const attrs = readFileSync(`${root}.gitattributes`, 'utf8');
    expect(attrs).toMatch(/\*\.sh\s+text\s+eol=lf/);
    expect(attrs).toMatch(/entrypoint\.sh\s+text\s+eol=lf/);
  });
});
