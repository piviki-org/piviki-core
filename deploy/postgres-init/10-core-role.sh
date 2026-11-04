#!/bin/sh
# Runs once, on an empty data directory. Core uses a non-superuser role that owns only its
# own database (AD-17 hardening). The superuser password stays in postgres.env.
set -eu
: "${PIVIKI_CORE_DB_PASSWORD:?PIVIKI_CORE_DB_PASSWORD missing from postgres.env}"

psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  --set=core_password="$PIVIKI_CORE_DB_PASSWORD" <<'SQL'
CREATE ROLE piviki_core LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'core_password';
CREATE DATABASE piviki OWNER piviki_core;
REVOKE ALL ON DATABASE piviki FROM PUBLIC;
\connect piviki
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO piviki_core;
SQL
