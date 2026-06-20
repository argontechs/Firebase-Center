import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockProviders } from './mock-providers';

/**
 * End-to-end smoke test: runs scripts/smoke.sh against a fresh Docker Compose
 * stack (docker-compose.yml + docker-compose.smoke.yml) with provider HTTP calls
 * intercepted by the local mock server so no real FCM / Huawei credentials are
 * needed.
 *
 * This test is tagged @smoke and skipped by default in the standard Vitest run
 * unless RUN_SMOKE=1 is set.  In CI it is driven by the dedicated smoke job.
 *
 * Requires: Docker installed and running, bash on PATH, the project .env
 * populated with NUXT_BO_ADMIN_EMAIL / NUXT_BO_ADMIN_PASSWORD / NUXT_DATABASE_URL /
 * NUXT_BO_MASTER_KEY / NUXT_SESSION_PASSWORD / POSTGRES_* vars.
 */

const RUN_SMOKE = process.env.RUN_SMOKE === '1';

describe.skipIf(!RUN_SMOKE)('smoke: full end-to-end flow against mocked providers', () => {
  let mock: Awaited<ReturnType<typeof startMockProviders>>;
  let backupDir: string;

  beforeAll(async () => {
    mock = await startMockProviders(); // listens; returns { fcmUrl, huaweiUrl, oauthUrl, stop() }
    backupDir = mkdtempSync(join(tmpdir(), 'fc-smoke-'));
  }, 30_000);

  afterAll(async () => {
    await mock.stop();
    rmSync(backupDir, { recursive: true, force: true });
  });

  it('runs the full smoke flow against mocked providers and a fresh DB', () => {
    const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

    // The mock server binds to 0.0.0.0 so it is reachable from inside Docker
    // containers, but mock.fcmUrl / mock.huaweiUrl / mock.oauthUrl contain
    // 127.0.0.1 (the host loopback) which is unreachable inside a container.
    // Rewrite the host part to host.docker.internal so the containerised app
    // reaches the host-side mock.  The docker-compose.smoke.yml extra_hosts
    // entry resolves host.docker.internal to the host gateway on Linux.
    const toDockerHostUrl = (url: string) =>
      url.replace('127.0.0.1', 'host.docker.internal');

    const out = execFileSync('bash', ['scripts/smoke.sh'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BACKUP_DIR: backupDir,
        FCM_BASE_URL: toDockerHostUrl(mock.fcmUrl),
        FCM_OAUTH_URL: toDockerHostUrl(mock.oauthUrl),
        HUAWEI_BASE_URL: toDockerHostUrl(mock.huaweiUrl),
        HUAWEI_OAUTH_URL: toDockerHostUrl(mock.oauthUrl),
      },
      encoding: 'utf8',
      // 10-minute timeout: Docker build + bring-up + full flow
      timeout: 600_000,
    });

    expect(out).toContain('HEALTHZ_OK');
    expect(out).toContain('LOGIN_OK');
    expect(out).toContain('CSRF_OK');
    expect(out).toContain('CREDENTIAL_SAVED');
    expect(out).toContain('IMPORT_OK inserted=2');
    expect(out).toContain('SEND_OK sent=2 failed=0');
    expect(out).toContain('BACKUP_RESTORE_OK');
    expect(readdirSync(backupDir).some((f) => f.endsWith('.dump'))).toBe(true);
  }, 600_000);
});
