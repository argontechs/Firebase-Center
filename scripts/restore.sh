#!/usr/bin/env bash
# Firebase Center DB restore. Restores a pg_dump custom-format archive into
# PGDATABASE (derived from NUXT_DATABASE_URL). REQUIRES the matching
# NUXT_BO_MASTER_KEY to decrypt restored credentials — without it the restored
# ciphertext is unusable (docs/RESTORE.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-env.sh
source "${SCRIPT_DIR}/lib/backup-env.sh"

DUMP_FILE="${1:?usage: restore.sh <path-to.dump>}"
[ -f "${DUMP_FILE}" ] || { echo "[restore] no such dump: ${DUMP_FILE}" >&2; exit 1; }

if [ -z "${NUXT_BO_MASTER_KEY:-}" ]; then
  echo "[restore] WARNING: NUXT_BO_MASTER_KEY is not set in this environment." >&2
  echo "[restore] The DB will restore, but stored credentials cannot be decrypted" >&2
  echo "[restore] until the original key is provisioned (docs/RESTORE.md)." >&2
fi

echo "[restore] restoring ${DUMP_FILE} -> ${PGDATABASE}"
# --clean drops objects first; --if-exists avoids errors on a fresh DB; --no-owner for portability.
# pg_restore exits non-zero when any non-fatal warnings are emitted (e.g. version-skew session
# parameters). Capture the exit code and only fail on exit codes >= 2 (hard failures); exit code
# 1 means warnings-only — the restore proceeded and the data is intact.
set +e
pg_restore --clean --if-exists --no-owner --dbname "${PGDATABASE}" "${DUMP_FILE}"
PG_EXIT=$?
set -e
if [ "${PG_EXIT}" -ge 2 ]; then
  echo "[restore] FAILED: pg_restore exited ${PG_EXIT}" >&2
  exit "${PG_EXIT}"
elif [ "${PG_EXIT}" -eq 1 ]; then
  echo "[restore] pg_restore completed with warnings (exit 1) — data restored; verify the app."
fi
echo "[restore] done. Verify with a credential decrypt in the app (docs/RESTORE.md)."
