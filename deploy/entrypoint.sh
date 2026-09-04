#!/usr/bin/env bash
# SDODS container entrypoint.
#   serve      → migrate the database, then start the server (default)
#   bootstrap  → create the platform admin (idempotent) and sync the hierarchy
#   <anything> → passed straight to the sdods CLI (e.g. "db status", "run -p demo-shop")
#
# DATABASE_URL is composed from DB_PASSWORD + CLOUDSQL_CONNECTION (Cloud Run) when not set,
# so the password never appears in plain env vars: it arrives from Secret Manager.
set -euo pipefail
cd "${SDODS_ROOT:-/app}"

SDODS="node --import tsx packages/cli/src/bin.ts"

if [[ "${DB_DRIVER:-sqlite}" == "postgres" && -z "${DATABASE_URL:-}" ]]; then
  : "${DB_PASSWORD:?DB_PASSWORD (secret) is required when DATABASE_URL is not set}"
  DB_USER="${DB_USER:-sdods}"
  DB_NAME="${DB_NAME:-sdods}"
  ENC_PW=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")
  if [[ -n "${CLOUDSQL_CONNECTION:-}" ]]; then
    # Cloud SQL connector mounts a unix socket at /cloudsql/<project:region:instance>
    export DATABASE_URL="postgres://${DB_USER}:${ENC_PW}@localhost/${DB_NAME}?host=/cloudsql/${CLOUDSQL_CONNECTION}"
  else
    export DATABASE_URL="postgres://${DB_USER}:${ENC_PW}@${DB_HOST:-127.0.0.1}:${DB_PORT:-5432}/${DB_NAME}"
  fi
fi

mkdir -p "${SDODS_ARTIFACTS_DIR:-/data/runs}"

case "${1:-serve}" in
  serve)
    $SDODS db migrate
    $SDODS db sync || true
    exec $SDODS serve --host "${HOST:-0.0.0.0}" --port "${PORT:-8080}"
    ;;
  bootstrap)
    : "${ADMIN_USERNAME:=admin}"
    : "${ADMIN_PASSWORD:?ADMIN_PASSWORD (secret) is required for bootstrap}"
    $SDODS db migrate
    $SDODS db sync || true
    if $SDODS --json users list 2>/dev/null | grep -q "\"username\": *\"${ADMIN_USERNAME}\""; then
      echo "admin ${ADMIN_USERNAME} already exists"
    else
      $SDODS users create --admin --username "$ADMIN_USERNAME" --password "$ADMIN_PASSWORD"
    fi
    ;;
  *)
    exec $SDODS "$@"
    ;;
esac
