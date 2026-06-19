#!/usr/bin/env sh
set -e

# 1) wait for Postgres readiness (parse host/port from NUXT_DATABASE_URL)
DB_HOST="$(printf '%s' "$NUXT_DATABASE_URL" | sed -E 's#.*@([^:/]+).*#\1#')"
DB_PORT="$(printf '%s' "$NUXT_DATABASE_URL" | sed -E 's#.*:([0-9]+)/.*#\1#')"
: "${DB_PORT:=5432}"

echo "[entrypoint] waiting for db at ${DB_HOST}:${DB_PORT} ..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] db is ready"

# 2) apply committed versioned migrations idempotently
echo "[entrypoint] running migrations"
npm run db:migrate

# 3) seed first admin only if the users table is empty
#    (a SeedError exits non-zero here, so set -e aborts the boot loudly)
echo "[entrypoint] seeding first admin (if empty)"
npm run db:seed

# 4) serve Nitro
echo "[entrypoint] starting server"
exec node .output/server/index.mjs
