import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

const NUXT_DATABASE_URL = 'postgres://fc:fc@127.0.0.1:55432/firebase_center_test';
const pgClientConfig = {
  host: '127.0.0.1', port: 55432, user: 'fc', password: 'fc', database: 'firebase_center_test',
};
// Versioned master key: "<version>:<base64-32-bytes>" — exactly what M3.1 loadKeys expects.
const MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;

// Ensure pg_dump / pg_restore are on PATH (Homebrew libpq on macOS is keg-only).
const HOMEBREW_LIBPQ_CANDIDATES = [
  '/opt/homebrew/opt/libpq/bin', // Apple Silicon
  '/usr/local/opt/libpq/bin',    // Intel Mac
];
const LIBPQ_BIN = HOMEBREW_LIBPQ_CANDIDATES.find((d) => existsSync(d)) ?? '';
const PATH_WITH_PG = LIBPQ_BIN
  ? `${LIBPQ_BIN}:${process.env.PATH ?? ''}`
  : (process.env.PATH ?? '');

let backupDir: string;

beforeAll(() => {
  process.env.NUXT_BO_MASTER_KEY = MASTER_KEY;
  backupDir = mkdtempSync(join(tmpdir(), 'fc-restore-'));
});
afterAll(() => rmSync(backupDir, { recursive: true, force: true }));

describe('scripts/restore.sh', () => {
  it('restores ciphertext that decrypts only with the original master key', async () => {
    const { encryptSecret, decryptSecret } = await import('../../server/utils/crypto');

    const plaintext = JSON.stringify({ private_key: 'PK-' + randomBytes(8).toString('hex') });
    const enc = encryptSecret(plaintext);

    const c1 = new Client(pgClientConfig);
    await c1.connect();
    await c1.query('DROP TABLE IF EXISTS restore_marker');
    await c1.query('CREATE TABLE restore_marker (id int primary key, ct text, nonce text, tag text, kv int)');
    await c1.query('INSERT INTO restore_marker VALUES (1,$1,$2,$3,$4)',
      [enc.ciphertext, enc.nonce, enc.tag, enc.keyVersion]);
    await c1.end();

    // backup
    execFileSync('bash', ['scripts/backup.sh'],
      { env: { ...process.env, PATH: PATH_WITH_PG, NUXT_DATABASE_URL, BACKUP_DIR: backupDir }, stdio: 'pipe' });

    // simulate disaster: drop the table
    const c2 = new Client(pgClientConfig);
    await c2.connect();
    await c2.query('DROP TABLE restore_marker');
    await c2.end();

    // restore
    const dump = readdirSync(backupDir).find((f) => f.endsWith('.dump'))!;
    execFileSync('bash', ['scripts/restore.sh', join(backupDir, dump)],
      { env: { ...process.env, PATH: PATH_WITH_PG, NUXT_DATABASE_URL }, stdio: 'pipe' });

    // ciphertext came back
    const c3 = new Client(pgClientConfig);
    await c3.connect();
    const { rows } = await c3.query('SELECT ct, nonce, tag, kv FROM restore_marker WHERE id=1');
    await c3.end();
    expect(rows.length).toBe(1);

    // decrypts with the original key
    const recovered = decryptSecret({
      ciphertext: rows[0].ct, nonce: rows[0].nonce, tag: rows[0].tag, keyVersion: rows[0].kv,
    });
    expect(recovered).toBe(plaintext);
  });
});
