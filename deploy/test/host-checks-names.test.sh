#!/usr/bin/env bash
# deploy/host-checks.mjs refuses caddy.env host names that disagree with the host's environment
# name (AD-17) before sending any request. A local fake Caddy counts the requests it gets.
# Run: deploy/test/host-checks-names.test.sh (needs node).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
checks="$here/../host-checks.mjs"
tmp="$(mktemp -d)"
trap 'kill "$server" 2>/dev/null || true; rm -rf "$tmp"' EXIT # only the folder this test created

# Fake Caddy: answers 404 to everything and appends one line per request to the log.
cat >"$tmp/server.mjs" <<'FAKE'
import http from 'node:http'
import fs from 'node:fs'
const [log, portFile] = process.argv.slice(2)
const server = http.createServer((req, res) => {
  fs.appendFileSync(log, `${req.headers.host} ${req.url}\n`)
  res.statusCode = 404
  res.end()
})
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)))
FAKE
: >"$tmp/log"
node "$tmp/server.mjs" "$tmp/log" "$tmp/port" &
server=$!
for _ in $(seq 50); do [[ -s "$tmp/port" ]] && break; sleep 0.1; done
port="$(cat "$tmp/port")"

failed=0
run() { # <name> <want exit> <environment> <admin host> <api host> <admin origin>
  local got=0
  : >"$tmp/log"
  CADDY_ADDR=127.0.0.1 CADDY_PORT="$port" ENVIRONMENT="$3" ADMIN_HOST="$4" API_HOST="$5" \
    ADMIN_ORIGIN="$6" node "$checks" >"$tmp/out" 2>&1 || got=$?
  if [[ "$got" != "$2" ]]; then
    echo "FAIL  $1: exit $got, want $2"; sed 's/^/      /' "$tmp/out"; failed=1
  elif [[ "$2" == 1 && -s "$tmp/log" ]]; then
    echo "FAIL  $1: requests were sent"; failed=1
  else
    echo "PASS  $1"
  fi
}

run "test with a production admin host fails before any request" 1 test admin.piviki.fi test-api.piviki.fi https://test-admin.piviki.fi
run "test with a production api host fails before any request" 1 test test-admin.piviki.fi api.piviki.fi https://test-admin.piviki.fi
run "test with a production Origin fails before any request" 1 test test-admin.piviki.fi test-api.piviki.fi https://admin.piviki.fi
run "production with a test host fails before any request" 1 production test-admin.piviki.fi api.piviki.fi https://admin.piviki.fi
run "production with a malformed Origin fails before any request" 1 production admin.piviki.fi api.piviki.fi not-a-url
run "local with a public host fails before any request" 1 local admin.piviki.fi api.localhost http://admin.localhost:8080
run "a missing environment name is refused" 64 "" test-admin.piviki.fi test-api.piviki.fi https://test-admin.piviki.fi

# Agreeing names go on to the HTTP checks (which fail here: the fake answers 404 to all).
: >"$tmp/log"
CADDY_ADDR=127.0.0.1 CADDY_PORT="$port" ENVIRONMENT=test ADMIN_HOST=test-admin.piviki.fi \
  API_HOST=test-api.piviki.fi ADMIN_ORIGIN=https://test-admin.piviki.fi node "$checks" >"$tmp/out" 2>&1 || true
if [[ -s "$tmp/log" ]] && ! grep -q 'is not a test host name' "$tmp/out"; then
  echo "PASS  test host names on test reach the HTTP checks"
else
  echo "FAIL  agreeing names did not reach the HTTP checks"; sed 's/^/      /' "$tmp/out"; failed=1
fi

exit "$failed"
