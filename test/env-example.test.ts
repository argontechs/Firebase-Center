import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('.env.example', () => {
  const env = readFileSync(`${root}.env.example`, 'utf8');

  it('declares every required variable', () => {
    for (const key of [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'NUXT_DATABASE_URL',
      'NUXT_BO_MASTER_KEY',
      'NUXT_BO_ADMIN_EMAIL',
      'NUXT_BO_ADMIN_PASSWORD',
      'NUXT_SESSION_PASSWORD',
    ]) {
      expect(env, `missing ${key}`).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });

  it('documents the master-key separate-backup footgun', () => {
    expect(env.toLowerCase()).toMatch(/back.*up.*separately|separately.*from.*db|separate.*backup/);
  });
});
