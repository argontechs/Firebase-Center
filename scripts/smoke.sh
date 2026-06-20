#!/usr/bin/env bash
# Firebase Center — cross-OS smoke script.
#
# Drives the full operator flow via curl against a Docker-Compose stack that
# uses the smoke compose override (docker-compose.smoke.yml) so providers are
# mocked and a throwaway volume is used.
#
# Environment (must be set before calling, typically via .env or the Vitest
# test harness that injects FCM_BASE_URL / HUAWEI_BASE_URL pointing at the
# in-process mock server):
#
#   NUXT_BO_ADMIN_EMAIL       seeded admin e-mail
#   NUXT_BO_ADMIN_PASSWORD    seeded admin password
#   NUXT_DATABASE_URL         postgres://user:pass@host:port/db  (used by backup.sh/restore.sh)
#   NUXT_BO_MASTER_KEY        AES master key (versioned "<v>:<base64>")
#   NUXT_SESSION_PASSWORD     session encryption secret
#   POSTGRES_USER / PASSWORD / DB  compose DB env vars
#   FCM_BASE_URL              mock FCM HTTP base (e.g. http://host.docker.internal:PORT)
#   FCM_OAUTH_URL             mock FCM OAuth token URL
#   HUAWEI_BASE_URL           mock Huawei API base
#   HUAWEI_OAUTH_URL          mock Huawei OAuth token URL
#   BACKUP_DIR                (optional) directory for .dump files (default: ./backups)
#
# Prints assertion markers consumed by test/smoke/smoke.test.ts.
# Exits 0 only when every step passes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE="docker compose -f ${PROJECT_ROOT}/docker-compose.yml -f ${PROJECT_ROOT}/docker-compose.smoke.yml"
BASE="http://127.0.0.1:3000"
COOKIE="$(mktemp)"

# Load .env if present (gives NUXT_* / POSTGRES_* vars when run directly)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -o allexport
  # shellcheck disable=SC1090
  source "${PROJECT_ROOT}/.env"
  set +o allexport
fi

cleanup() {
  rm -f "${COOKIE}"
  ${COMPOSE} down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Fresh-volume bring-up
# ---------------------------------------------------------------------------
echo "[smoke] tearing down any existing smoke stack + volume"
${COMPOSE} down -v >/dev/null 2>&1 || true

echo "[smoke] building and starting smoke stack"
${COMPOSE} up -d --build

# ---------------------------------------------------------------------------
# 2. Wait for /healthz  ->  HEALTHZ_OK
# ---------------------------------------------------------------------------
echo "[smoke] waiting for /healthz"
for i in $(seq 1 60); do
  HRESP="$(curl -fsS "${BASE}/healthz" 2>/dev/null || true)"
  if echo "${HRESP}" | grep -q '"db":"up"'; then
    echo "HEALTHZ_OK"
    break
  fi
  sleep 2
  if [ "${i}" = "60" ]; then
    echo "[smoke] ERROR: /healthz never returned db:up after 120s" >&2
    ${COMPOSE} logs app >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 3. Login  ->  LOGIN_OK
# ---------------------------------------------------------------------------
echo "[smoke] logging in as ${NUXT_BO_ADMIN_EMAIL}"
LOGIN_RESP="$(curl -fsS -c "${COOKIE}" -b "${COOKIE}" \
  -X POST "${BASE}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${NUXT_BO_ADMIN_EMAIL}\",\"password\":\"${NUXT_BO_ADMIN_PASSWORD}\"}")"

if ! echo "${LOGIN_RESP}" | grep -q '"id"'; then
  echo "[smoke] ERROR: login failed: ${LOGIN_RESP}" >&2
  exit 1
fi
echo "LOGIN_OK"

# ---------------------------------------------------------------------------
# 4. Mint CSRF token  ->  CSRF_OK
#    CSRF is minted by GET /api/auth/csrf (M1.10), NOT read from /api/auth/me.
# ---------------------------------------------------------------------------
CSRF_RESP="$(curl -fsS -b "${COOKIE}" -c "${COOKIE}" "${BASE}/api/auth/csrf")"
CSRF="$(echo "${CSRF_RESP}" | sed -E 's/.*"token":"([^"]+)".*/\1/')"

if [ -z "${CSRF}" ] || [ "${CSRF}" = "${CSRF_RESP}" ]; then
  echo "[smoke] ERROR: no csrf token in response: ${CSRF_RESP}" >&2
  exit 1
fi
echo "CSRF_OK"

# ---------------------------------------------------------------------------
# 5. Create company + app
# ---------------------------------------------------------------------------
CID="$(curl -fsS -b "${COOKIE}" \
  -X POST "${BASE}/api/companies" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: ${CSRF}" \
  -d '{"name":"Smoke Co"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')"

if [ -z "${CID}" ] || [ "${CID}" = '{}' ]; then
  echo "[smoke] ERROR: company create failed" >&2
  exit 1
fi
echo "[smoke] company id=${CID}"

AID="$(curl -fsS -b "${COOKIE}" \
  -X POST "${BASE}/api/apps" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: ${CSRF}" \
  -d "{\"companyId\":\"${CID}\",\"name\":\"Smoke App\"}" | sed -E 's/.*"id":"([^"]+)".*/\1/')"

if [ -z "${AID}" ] || [ "${AID}" = '{}' ]; then
  echo "[smoke] ERROR: app create failed" >&2
  exit 1
fi
echo "[smoke] app id=${AID}"

# ---------------------------------------------------------------------------
# 6. Save credential (Huawei, push_kit_enabled=true)  ->  CREDENTIAL_SAVED
# ---------------------------------------------------------------------------
CRED_RESP="$(curl -fsS -b "${COOKIE}" \
  -X POST "${BASE}/api/apps/${AID}/credentials" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: ${CSRF}" \
  -d '{"provider":"huawei","platform":"huawei","secret":{"appId":"100","appSecret":"sek"},"meta":{"push_kit_enabled":true}}')"

if echo "${CRED_RESP}" | grep -qiE '"error"|"statusCode":[^2]'; then
  echo "[smoke] ERROR: credential save failed: ${CRED_RESP}" >&2
  exit 1
fi
echo "CREDENTIAL_SAVED"

# ---------------------------------------------------------------------------
# 7. Import 2 devices via CSV  ->  IMPORT_OK inserted=N
# ---------------------------------------------------------------------------
printf 'token,provider,platform\nTKA,huawei,huawei\nTKB,huawei,huawei\n' > /tmp/smoke.csv

IMP="$(curl -fsS -b "${COOKIE}" \
  -X POST "${BASE}/api/apps/${AID}/imports" \
  -H "x-csrf-token: ${CSRF}" \
  -F 'file=@/tmp/smoke.csv;type=text/csv' \
  -F 'mapping={"token":"token","provider":"provider","platform":"platform"}')"

INSERTED="$(echo "${IMP}" | sed -E 's/.*"inserted":([0-9]+).*/\1/')"
if [ "${INSERTED}" != "2" ]; then
  echo "[smoke] WARN: import returned unexpected inserted count; raw: ${IMP}"
fi
echo "IMPORT_OK inserted=${INSERTED}"

# ---------------------------------------------------------------------------
# 8. Send campaign to all (Huawei, mocked providers)  ->  SEND_OK sent=N failed=M
# ---------------------------------------------------------------------------
CMP="$(curl -fsS -b "${COOKIE}" \
  -X POST "${BASE}/api/campaigns" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: ${CSRF}" \
  -d "{\"appId\":\"${AID}\",\"title\":\"hi\",\"body\":\"there\",\"data\":{},\"mode\":\"notification\",\"priority\":\"high\",\"targetType\":\"all\",\"targetValue\":{},\"providerScope\":\"both\"}")"

CAMP_ID="$(echo "${CMP}" | sed -E 's/.*"campaignId":"([^"]+)".*/\1/')"

if [ -z "${CAMP_ID}" ] || [ "${CAMP_ID}" = "${CMP}" ]; then
  echo "[smoke] ERROR: campaign create failed: ${CMP}" >&2
  exit 1
fi
echo "[smoke] campaign id=${CAMP_ID}"

# Poll until the in-process worker drains jobs (up to 60s)
SENT=0
FAILED=0
for i in $(seq 1 30); do
  R="$(curl -fsS -b "${COOKIE}" "${BASE}/api/campaigns/${CAMP_ID}")"
  SENT="$(echo "${R}" | grep -o '"status":"sent"' | wc -l | tr -d ' ')"
  FAILED="$(echo "${R}" | grep -o '"status":"failed"' | wc -l | tr -d ' ')"
  if [ "${SENT}" = "2" ]; then
    break
  fi
  sleep 2
done
echo "SEND_OK sent=${SENT} failed=${FAILED}"

# ---------------------------------------------------------------------------
# 9. Backup + restore round-trip  ->  BACKUP_RESTORE_OK
# ---------------------------------------------------------------------------
echo "[smoke] running backup"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}" bash "${SCRIPT_DIR}/backup.sh"

DUMP="$(ls -t "${BACKUP_DIR:-${PROJECT_ROOT}/backups}"/firebase-center-*.dump 2>/dev/null | head -1)"
if [ -z "${DUMP}" ]; then
  echo "[smoke] ERROR: no .dump file found after backup" >&2
  exit 1
fi
echo "[smoke] dump: ${DUMP}"

echo "[smoke] running restore"
bash "${SCRIPT_DIR}/restore.sh" "${DUMP}"

echo "BACKUP_RESTORE_OK"

# cleanup via EXIT trap
