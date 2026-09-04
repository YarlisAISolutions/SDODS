#!/usr/bin/env bash
# SDODS tests SDODS: build the web app, start a server on a scratch SQLite database with
# an admin (org owner) and a workspace member, run projects/sdods-web, stop the server.
#
#   bun run dogfood                  # @smoke on chromium (fast)
#   bun run dogfood -- -t "@smoke or @regression" --project-matrix
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${DOGFOOD_PORT:-4477}"
DB=".sdods/dogfood.db"
LOG=".sdods/dogfood-serve.log"
export DB_DRIVER=sqlite SQLITE_PATH="$DB" PORT HOST=127.0.0.1
export SESSION_SECRET="${SESSION_SECRET:-dogfood-secret-32-characters-long-xxxx}"
# three browsers sign in over and over from one IP; the production default is 10/min
export SDODS_LOGIN_RATE_LIMIT="${SDODS_LOGIN_RATE_LIMIT:-1000}"
export SDODS_UI_ADMIN_PASSWORD="${SDODS_UI_ADMIN_PASSWORD:-Admin#12345}"
export SDODS_UI_VERA_PASSWORD="${SDODS_UI_VERA_PASSWORD:-Vera#12345}"

A() { node --import tsx packages/cli/src/bin.ts "$@"; }

echo "▶ building web app"
bun run --filter @sdods/web build >/dev/null

echo "▶ provisioning scratch database ($DB)"
rm -f "$DB" "$DB-wal" "$DB-shm"
A db migrate >/dev/null
A db sync >/dev/null
A users create --admin --username admin --password "$SDODS_UI_ADMIN_PASSWORD" >/dev/null
A users create --username vera --password "$SDODS_UI_VERA_PASSWORD" --role viewer >/dev/null
A users grant vera --workspace platform-qa --role viewer >/dev/null
SDODS_TOKEN="$(A --json tokens create --user admin --name dogfood-api | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d.slice(d.indexOf("{")));console.log(j.token||j.value||"")})')"
export SDODS_TOKEN
[ -n "$SDODS_TOKEN" ] || { echo "could not create an API token"; exit 2; }

echo "▶ starting server on http://127.0.0.1:$PORT"
node --import tsx packages/cli/src/bin.ts serve >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "server did not start; see $LOG"; exit 2; }

echo "▶ running projects/sdods-web"
rm -rf projects/sdods-web/.auth
if [ $# -gt 0 ]; then
  # the server shares this machine with the browsers: cap workers unless the caller sets them
  case " $* " in
    *" -w "*|*" --workers "*) A run -p sdods-web -e local "$@" ;;
    *) A run -p sdods-web -e local -w 2 "$@" ;;
  esac
else
  A run -p sdods-web -e local -b chromium -t "@smoke"
fi
