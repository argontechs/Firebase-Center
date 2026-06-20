#!/usr/bin/env bash
# Firebase Center DB backup. Produces a compressed custom-format pg_dump
# archive and prunes old archives. REMINDER: a dump is useless without a
# separately-backed-up NUXT_BO_MASTER_KEY (see docs/RESTORE.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-env.sh
source "${SCRIPT_DIR}/lib/backup-env.sh"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "${BACKUP_DIR}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/firebase-center-${TS}.dump"

echo "[backup] dumping ${PGDATABASE} -> ${OUT}"
# -Fc custom format (compressed, restorable selectively), --no-owner for portability
pg_dump -Fc --no-owner --file "${OUT}" "${PGDATABASE}"
echo "[backup] done: $(du -h "${OUT}" | cut -f1)"

echo "[backup] pruning dumps older than ${BACKUP_RETENTION_DAYS} days in ${BACKUP_DIR}"
find "${BACKUP_DIR}" -name 'firebase-center-*.dump' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

echo "[backup] off-host reminder: copy ${OUT} off this host; back up NUXT_BO_MASTER_KEY separately (docs/RESTORE.md)"
