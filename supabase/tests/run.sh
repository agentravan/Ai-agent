#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres (>=15) and runs the RLS test suite.
# Usage: PGBIN=/usr/lib/postgresql/16/bin npm run test:db
set -euo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres || echo /usr/lib/postgresql/16/bin/postgres)")}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$(mktemp -d)"; PORT="${PGPORT_TEST:-54329}"
RUN=""; [ "$(id -u)" = "0" ] && { chown postgres "$DIR"; RUN="su postgres -c"; }
sh_() { if [ -n "$RUN" ]; then $RUN "$1"; else bash -c "$1"; fi; }
cleanup() { sh_ "$PGBIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$DIR"; }
trap cleanup EXIT
sh_ "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null && $PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="psql -h $DIR -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -d postgres"
$P -f "$ROOT/supabase/tests/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $P -f "$f"; done
$P -f "$ROOT/supabase/tests/rls_test.sql"
