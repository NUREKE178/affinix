#!/usr/bin/env bash
# Applies every migration in order to a fresh database on a local PostgreSQL 16 (Supabase stubbed), then runs the SQL
# test files given as arguments (default: tests/sql/*.test.sql). A failed assertion raises, so the script stops non-zero.
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-affinix_test}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
run -f tests/sql/supabase-stubs.sql >/dev/null
for f in supabase/migrations/*.sql; do
  run -f "$f" >/dev/null 2>"/tmp/affinix-migration.err" || { echo "migration failed: $f"; cat /tmp/affinix-migration.err; exit 1; }
done
# the newer migrations (0021 on) promise to be safe to run twice
for f in supabase/migrations/002[1-9]*.sql supabase/migrations/00[3-9]*.sql; do
  [ -e "$f" ] || continue
  run -f "$f" >/dev/null 2>"/tmp/affinix-migration.err" || { echo "second run failed: $f"; cat /tmp/affinix-migration.err; exit 1; }
done
echo "migrations: applied (0021+ twice)"
tests=("$@"); [ ${#tests[@]} -eq 0 ] && tests=(tests/sql/*.test.sql)
for t in "${tests[@]}"; do
  set +e
  out=$(run -f "$t" 2>&1); code=$?
  set -e
  printf '%s\n' "$out" | { grep -E "^(psql|NOTICE|ERROR)" || true; } | sed -E 's/^psql:[^ ]+ NOTICE:  //; s/^NOTICE:  //'
  [ $code -eq 0 ] || { echo "FAILED: $t"; exit 1; }
done
