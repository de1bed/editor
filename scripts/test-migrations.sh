#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway Postgres (with pgvector) and runs
# supabase/tests/*.sql. Uses $DATABASE_URL if set, otherwise a local cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DATABASE_URL:-postgresql://postgres@localhost:5432/postgres}
NAME="editor_migrations_test_$$"
psql "$DB" -v ON_ERROR_STOP=1 -qc "create database $NAME" >/dev/null
URL="${DB%/*}/$NAME"
trap 'psql "$DB" -qc "drop database if exists $NAME" >/dev/null' EXIT
psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/supabase-stubs.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/rls_and_functions.sql
