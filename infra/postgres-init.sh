#!/bin/sh
set -eu

# Initial roles only. Schema changes belong to checksum-verified migrations.
PGPASSWORD="$POSTGRES_PASSWORD" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --set=migrator_password="$AW_PG_MIGRATOR_PASSWORD" \
  --set=writer_password="$AW_PG_WRITER_PASSWORD" \
  --set=reader_password="$AW_PG_READER_PASSWORD" <<'SQL'
BEGIN;
CREATE ROLE aw_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE aw_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'writer_password';
CREATE ROLE aw_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'reader_password';
ALTER DATABASE autoworld OWNER TO aw_migrator;
REVOKE ALL ON DATABASE autoworld FROM PUBLIC;
GRANT CONNECT ON DATABASE autoworld TO aw_migrator, aw_writer, aw_reader;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER ROLE aw_migrator SET search_path = pg_catalog;
ALTER ROLE aw_writer SET search_path = pg_catalog;
ALTER ROLE aw_reader SET search_path = pg_catalog;
ALTER ROLE aw_writer SET statement_timeout = '15s';
ALTER ROLE aw_writer SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE aw_reader SET statement_timeout = '15s';
COMMIT;
SQL
