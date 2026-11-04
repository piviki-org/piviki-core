#!/bin/sh
# piviki-core container entrypoint.
#   start           run pending migrations, then start the server (default)
#   migrate         run pending migrations only (deploy.sh runs this before `up`)
#   seed-librarian  create a librarian from stdin (two lines: email, password) [--force]
set -eu

migrate() {
  cd /app/tools
  node_modules/.bin/payload migrate
}

cmd="${1:-start}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  start)
    migrate
    cd /app/server
    exec node server.js
    ;;
  migrate)
    migrate
    ;;
  seed-librarian)
    cd /app/tools
    exec node_modules/.bin/tsx scripts/seed-librarian.ts "$@"
    ;;
  *)
    echo "usage: piviki-core [start|migrate|seed-librarian [--force]]" >&2
    exit 64
    ;;
esac
