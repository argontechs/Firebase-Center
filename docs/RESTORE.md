# Restore Runbook — Firebase Center

> A DB backup is **useless on its own**. Restoring a working system requires
> **TWO independently-backed-up assets**:
>
> 1. A `pg_dump` archive (`firebase-center-<UTC>.dump`) — see `scripts/backup.sh`.
> 2. The **`NUXT_BO_MASTER_KEY`** that was active when those credentials were saved.
>
> The DB volume holds only **ciphertext**. Without the matching key, every stored
> provider secret (FCM service-account JSON, Huawei App Secret) is unrecoverable
> from the dump alone.

## Pre-requisites

- Docker installed on the target host.
- The latest `*.dump` retained off-host (never only on the failed host).
- `NUXT_BO_MASTER_KEY` retrieved from its **separate** out-of-band store (password
  manager / secrets vault) — it is never in the DB volume or git. It is a
  versioned string `"<version>:<base64-32-bytes>"`; multiple comma-separated
  versions may be present during rotation (highest = current default).

## Restore procedure

1. Provision `.env` on the target host. Set `NUXT_BO_MASTER_KEY` to the **same** value
   used when the credentials were encrypted, and `NUXT_DATABASE_URL` to the target DB.
   (If you are rotating, see "Two live key versions" below.)

2. Bring up the DB only:
   ```bash
   docker compose up -d db
   ```

3. Run the restore (it derives PG* connection vars from `NUXT_DATABASE_URL`):
   ```bash
   NUXT_DATABASE_URL=postgres://user:pass@host:port/dbname \
   NUXT_BO_MASTER_KEY="1:<base64-32-bytes>" \
     bash scripts/restore.sh /path/to/firebase-center-<UTC>.dump
   ```

4. Bring up the app:
   ```bash
   docker compose up -d app
   ```
   Migrations are idempotent and a no-op against a restored schema.

5. **Verify decryption**: open any app's credential page in the BO. A correctly
   paired key shows `configured: true` + the right `project_id`/App ID, and the
   send pipeline can mint tokens. A GCM tag-mismatch error here means the key
   does **not** match the dump.

## Recovery from key loss

If `NUXT_BO_MASTER_KEY` is lost and no backup of it survives, the ciphertext in the
dump **cannot** be decrypted by anyone (this is by design). Recovery is:

1. Restore the DB dump as above (companies, apps, devices, campaign history, and audit
   log all return).

2. **Re-enter every provider secret** via the write-only credential UI:
   - FCM: regenerate the service-account JSON in Firebase Console → Project
     Settings → Service accounts → Generate new private key.
   - Huawei: regenerate the App Secret in AppGallery Connect → Project settings.

3. Re-verify readiness flags (APNs `.p8` / VAPID for FCM; Push Kit
   `push_kit_enabled` for Huawei).

Audiences, campaign history, and audit log survive; only the encrypted secrets
must be re-supplied.

## Two live key versions during rotation

`app_credentials.key_version` lets two master keys coexist during rotation. List both
versions in `NUXT_BO_MASTER_KEY` (e.g. `"2:<new>,1:<old>"`); new encryptions use the
highest version, while rows still at the old `key_version` remain decryptable. Run
`POST /api/admin/master-key/rotate` to re-encrypt every row to the new version, then
retire the old key only once all rows are re-encrypted. If a historical key survives a
partial loss, rows at that `key_version` are still recoverable — keep retired keys until
every row is re-encrypted to the new version.

## Backup hygiene (companion to scripts/backup.sh)

- Run `scripts/backup.sh` on a schedule (cron / Task Scheduler) and **copy the
  dump off-host** immediately after each run.
- Back up `NUXT_BO_MASTER_KEY` **separately** from the dump and the DB volume — a host
  that holds both defeats the separation.
- Test-restore periodically using this runbook against a throwaway DB to confirm
  the procedure and the key still work together.
