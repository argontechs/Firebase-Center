#!/usr/bin/env sh
set -e
cd "$(dirname "$0")/.."

echo "[e2e] tearing down any prior stack + volume (fresh volume guarantee)"
docker compose down -v || true

echo "[e2e] building and starting the stack"
docker compose up -d --build

echo "[e2e] waiting for /healthz to return 200 (max ~90s)"
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/healthz)" = "200" ]; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then
    echo "[e2e] FAILED: /healthz never returned 200"
    docker compose logs app
    docker compose down -v
    exit 1
  fi
  sleep 1
done

echo "[e2e] /healthz body:"
HEALTH_BODY="$(curl -s http://localhost:3000/healthz)"
echo "$HEALTH_BODY"
echo
if ! echo "$HEALTH_BODY" | grep -q '"status"'; then
  echo "[e2e] FAILED: /healthz response does not contain \"status\" field"
  docker compose logs app
  docker compose down -v
  exit 1
fi
echo "[e2e] confirming migrations ran (users table exists on the fresh volume)"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt users' | grep -q users

echo "[e2e] PASS: fresh volume self-initialized and /healthz is 200"
docker compose down -v
