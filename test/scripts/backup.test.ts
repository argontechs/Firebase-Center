import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

// Test Postgres: the same container used by all integration tests.
// The script is driven the same way the app is: a single NUXT_DATABASE_URL.
const NUXT_DATABASE_URL = 'postgres://fc:fc@127.0.0.1:55432/firebase_center_test';
const pgClientConfig = {
  host: '127.0.0.1',
  port: 55432,
  user: 'fc',
  password: 'fc',
  database: 'firebase_center_test',
};

// Ensure pg_dump / pg_restore are on PATH (Homebrew libpq on macOS is keg-only).
const LIBPQ_BIN = '/opt/homebrew/opt/libpq/bin';
const PATH_WITH_PG = `${LIBPQ_BIN}:${process.env.PATH ?? ''}`;

let backupDir: string;

describe('scripts/backup.sh', () => {
  beforeAll(async () => {
    backupDir = mkdtempSync(join(tmpdir(), 'fc-backup-'));
    const c = new Client(pgClientConfig);
    await c.connect();
    await c.query(
      'CREATE TABLE IF NOT EXISTS smoke_marker (id int primary key, note text)',
    );
    await c.query(
      'INSERT INTO smoke_marker (id, note) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET note = excluded.note',
      ['backup-roundtrip'],
    );
    await c.end();
  });

  afterAll(() => {
    rmSync(backupDir, { recursive: true, force: true });
  });

  it('produces a custom-format dump that pg_restore can read', () => {
    execFileSync('bash', ['scripts/backup.sh'], {
      env: { ...process.env, PATH: PATH_WITH_PG, NUXT_DATABASE_URL, BACKUP_DIR: backupDir },
      stdio: 'pipe',
    });

    const dumps = readdirSync(backupDir).filter((f) => f.endsWith('.dump'));
    expect(dumps.length).toBe(1);
    expect(dumps[0]).toMatch(/^firebase-center-.*\.dump$/);

    // pg_restore --list exits 0 only on a valid archive
    const listing = execFileSync(
      join(LIBPQ_BIN, 'pg_restore'),
      ['--list', join(backupDir, dumps[0])],
      { encoding: 'utf8' },
    );
    expect(listing).toContain('smoke_marker');
  });
});
