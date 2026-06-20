#!/usr/bin/env bash
# Resolves Postgres connection env for backup/restore from NUXT_DATABASE_URL
# (the same variable the Nuxt app reads). If discrete PG* vars are already set
# they win; otherwise they are derived from the URL. Exits non-zero if neither
# NUXT_DATABASE_URL nor a full PG* set is present.
set -euo pipefail

if [ -z "${PGDATABASE:-}" ] && [ -n "${NUXT_DATABASE_URL:-}" ]; then
  # postgres://user:pass@host:port/dbname
  proto_removed="${NUXT_DATABASE_URL#*://}"
  creds="${proto_removed%@*}"
  hostpart="${proto_removed#*@}"
  export PGUSER="${creds%%:*}"
  export PGPASSWORD="${creds#*:}"
  hostport="${hostpart%%/*}"
  export PGHOST="${hostport%%:*}"
  export PGPORT="${hostport#*:}"
  dbpart="${hostpart#*/}"
  export PGDATABASE="${dbpart%%\?*}"   # strip any ?sslmode=... query string
fi

: "${PGHOST:?NUXT_DATABASE_URL (or PGHOST) required}"
: "${PGPORT:=5432}"
: "${PGUSER:?NUXT_DATABASE_URL (or PGUSER) required}"
: "${PGDATABASE:?NUXT_DATABASE_URL (or PGDATABASE) required}"
export PGHOST PGPORT PGUSER PGDATABASE
