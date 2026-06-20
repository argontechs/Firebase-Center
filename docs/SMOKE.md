# Cross-OS Smoke Checklist — Firebase Center

Run on each target OS before declaring a release production-ready. The scripted
core is `scripts/smoke.sh` (used by `test/smoke/smoke.test.ts`); this checklist
adds the OS-specific bring-up and the manual UI eyeballing.

---

## Pre-flight (all OSes)

- [ ] Docker installed and running (`docker version` succeeds).
- [ ] `.env` present with `NUXT_BO_MASTER_KEY` (versioned `"<v>:<base64>"`),
      `NUXT_BO_ADMIN_EMAIL`, `NUXT_BO_ADMIN_PASSWORD`, `NUXT_DATABASE_URL`,
      `NUXT_SESSION_PASSWORD`, and `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`.
- [ ] Repo checked out with **LF** line endings — verify:
      ```
      file scripts/smoke.sh    # should print: ASCII text
      ```
      On Windows, ensure `.gitattributes` is applied (`git config core.autocrlf false`
      then re-checkout, or use WSL / Git Bash for the run).
- [ ] `scripts/smoke.sh` is executable: `chmod +x scripts/smoke.sh` (Linux/macOS).
- [ ] `pg_dump` / `pg_restore` available on the host PATH (for backup/restore steps).
      On macOS: `brew install libpq && brew link --force libpq`.
      On Windows: install via [EDB installer](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) or use WSL.

---

## Automatable flow (run on every OS)

These steps are driven by `scripts/smoke.sh` and verified by `test/smoke/smoke.test.ts`
(`RUN_SMOKE=1 npx vitest run test/smoke/smoke.test.ts`).

### Linux / macOS

```bash
# From the project root, with .env populated:
bash scripts/smoke.sh
```

Or run via Vitest (starts the mock provider server automatically):

```bash
RUN_SMOKE=1 pnpm vitest run test/smoke/smoke.test.ts
```

### Windows (Git Bash or WSL)

Native PowerShell cannot run the bash script. Use one of:

```
# Git Bash
bash scripts/smoke.sh

# WSL (Ubuntu)
bash scripts/smoke.sh
```

The Linux container is identical across all three OSes — only the host shell
that invokes Docker differs.

### Expected output markers (all OSes)

Confirm the run prints, in order:

```
HEALTHZ_OK
LOGIN_OK
CSRF_OK
CREDENTIAL_SAVED
IMPORT_OK inserted=2
SEND_OK sent=2 failed=0
BACKUP_RESTORE_OK
```

---

## Provider mock (smoke run only)

During `RUN_SMOKE=1 vitest run`, `test/smoke/smoke.test.ts` starts an in-process
Node HTTP server that mocks the Huawei OAuth and Push Kit endpoints and injects
its address into the Docker Compose stack via `HUAWEI_BASE_URL` / `HUAWEI_OAUTH_URL`.

The container reaches the host mock server via `host.docker.internal` (set by
`docker-compose.smoke.yml`). No real FCM or Huawei credentials are required.

When running `bash scripts/smoke.sh` directly without the Vitest harness, set
the provider URLs manually to a running mock (or omit them to use the real
endpoints, which requires valid credentials in `.env`).

---

## Manual checks (all OSes)

These require a running stack (`docker compose up -d`) and a browser.

- [ ] **Fresh volume:** `docker compose up -d` on a machine with no existing
      `db_data` volume — migrations apply automatically, first admin seeds,
      Nitro serves at `http://localhost:3000`.
- [ ] **`GET /healthz`** returns `200 { "status":"ok", "db":"up" }`.
- [ ] **Login** as the seeded admin; the forced first-login password change
      prompt appears and works.
- [ ] **CSRF mint:** `GET /api/auth/csrf` returns `{ "token": "..." }` and
      a mutating `POST` without `x-csrf-token` header is rejected `403`.
- [ ] **Credential save:** the saved Huawei secret is write-only — re-reading
      the credential shows only `configured: true`, App ID, fingerprint, and
      `push_kit_enabled` flag (never the raw `appSecret`).
- [ ] **Import CSV:** import a file; counts reconcile (`inserted` / `updated` /
      `failed`); an unroutable row (unknown provider) lands in `failed`, not
      silently inserted.
- [ ] **Send (mocked):** create a campaign targeting all devices; deliveries
      show `sent`; a device with a forced-`UNREGISTERED` token (mock returning
      `80300007`) is marked `invalid`.
- [ ] **Admin: user management (§11):** an admin can create an operator, change
      its role, and disable it; a disabled operator session is rejected `403`
      from `/api/users/*`.
- [ ] **Master-key rotation (§8):** `POST /api/admin/master-key/rotate`
      re-encrypts all `app_credentials` rows to the new `key_version`; they
      still decrypt correctly afterwards.
- [ ] **Named volume portability:** `docker compose down` (without `-v`);
      `docker compose up -d` — data persists; no re-seed.
- [ ] **Backup → restore round-trip:** run `scripts/backup.sh` then
      `scripts/restore.sh <dump>` on a throwaway DB; credentials decrypt only
      with the original `NUXT_BO_MASTER_KEY` (see `docs/RESTORE.md`).
      > **FOOTGUN — `BO_MASTER_KEY` must be backed up out-of-band, stored
      > separately from the DB volume.  A dump without the matching
      > `NUXT_BO_MASTER_KEY` is useless — all credential secrets are
      > AES-encrypted with it and cannot be recovered from the dump alone.
      > Always store the key in a secrets manager or offline store that is
      > independent of the database backup path.**

---

## Secrets-in-logs check (all OSes)

```bash
docker compose logs app | grep -iE 'private_key|appSecret|BEGIN PRIVATE KEY|Bearer '
```

Expected: **no matches**. Any match is a regression — secrets must never be
written to container stdout/stderr.

---

## Named-volume portability note

`docker-compose.smoke.yml` uses a separate `fc_smoke_data` volume so the smoke
run never touches the production `db_data` volume. After the smoke run the
script tears down the smoke volume (`docker compose down -v`). This is safe
because `docker-compose.yml` and `docker-compose.smoke.yml` declare separate
named volumes.

---

## LF-endings verification (before each release)

```bash
git ls-files scripts/*.sh | xargs file | grep -v 'ASCII text'
```

Any `CRLF` output indicates a line-ending regression. Re-enforce with:

```bash
git add --renormalize .
git commit -m "chore: renormalize line endings"
```
