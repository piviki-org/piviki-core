#!/usr/bin/env bash
# Deploy checks (AD-5, AD-17), run after every deploy against the target's own hosts:
#   1. first-register returns 404 (admin view and REST route)
#   2. api path allowlist: only /api/v1/* is served; everything else 404
#   3. /api/v1/health is 200
#   4. exactly one Tunnel connector (Cloudflare API); skipped for `local`
# Plus the I/O matrix extras: foreign Origin on admin is 403, unknown host is 404 (local only).
#
# Usage: checks.sh local|production|test
#
# Environment for production/test (from the GitHub Environment):
#   ADMIN_HOST, API_HOST                 the target's host names
#   CF_ACCESS_CLIENT_ID/SECRET           Access service token allowed on the admin app
#   CF_API_TOKEN                         Cloudflare token with Tunnel read permission
#   CF_ACCOUNT_ID, CF_TUNNEL_ID          the target's Tunnel
#   SKIP_PUBLIC=1                        before the admin/api records exist (first deploy):
#                                        skip the HTTP checks here; deploy.sh has already run
#                                        the same checks in-network (host-checks.mjs)
# For `local`: the Compose local stack publishes Caddy on 127.0.0.1:${LOCAL_PORT:-8080}.
set -euo pipefail

target="${1:-}"
case "$target" in
  local)
    port="${LOCAL_PORT:-8080}"
    ADMIN_HOST="${ADMIN_HOST:-admin.localhost}"
    API_HOST="${API_HOST:-api.localhost}"
    scheme=http
    # Talk to the local Caddy with the real Host header, whatever the name resolves to.
    connect=(--connect-to "::127.0.0.1:${port}")
    host_port=":${port}"
    ;;
  production | test)
    if [[ "${SKIP_PUBLIC:-}" != 1 ]]; then
      : "${ADMIN_HOST:?}" "${API_HOST:?}"
      : "${CF_ACCESS_CLIENT_ID:?}" "${CF_ACCESS_CLIENT_SECRET:?}"
    fi
    : "${CF_API_TOKEN:?}" "${CF_ACCOUNT_ID:?}" "${CF_TUNNEL_ID:?}"
    scheme=https
    connect=()
    host_port=""
    ;;
  *)
    echo "usage: $0 local|production|test" >&2
    exit 64
    ;;
esac

admin="${scheme}://${ADMIN_HOST:-}${host_port}"
api="${scheme}://${API_HOST:-}${host_port}"
admin_origin="${scheme}://${ADMIN_HOST:-}${host_port}"

access_headers=()
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" ]]; then
  access_headers=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# status <curl args...>: prints the HTTP status code, never follows redirects. On a curl failure
# -w still prints 000.
status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --path-as-is "${connect[@]}" "$@" || true
}

# The admin login page: 200, or, until the first librarian is seeded (AD-5), Payload's redirect
# to create-first-user, which Caddy answers 404 (checked separately).
expect_login_page() {
  local got
  got="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "${connect[@]}" "$@" || true)"
  if [[ "$got" == "200 "* ]] || [[ "$got" =~ ^30[237]\ .*/admin/create-first-user$ ]]; then
    pass "admin login page ($got)"
  else
    fail "admin login page: want 200 or a redirect to create-first-user, got $got"
  fi
}

expect() {
  local want="$1" label="$2"
  shift 2
  local got
  got="$(status "$@")"
  if [[ "$got" == "$want" ]]; then pass "$label ($got)"; else fail "$label: want $want, got $got"; fi
}

public_checks() {
  echo "== first-register"
  expect 404 "admin GET /admin/create-first-user" "${access_headers[@]}" "$admin/admin/create-first-user"
  expect 404 "admin POST /api/librarians/first-register" "${access_headers[@]}" \
    -X POST -H 'Content-Type: application/json' -H "Origin: $admin_origin" \
    --data '{"email":"check@invalid.example","password":"not-a-real-password"}' \
    "$admin/api/librarians/first-register"

  echo "== api path allowlist"
  for path in / /admin /admin/login /api/librarians /api/librarians/me /api/librarians/first-register \
    /api/graphql /api/payload-jobs/run /api/v1 /api/v1/../librarians /api/v1/%2e%2e/librarians \
    /api/v1%2f..%2flibrarians; do
    expect 404 "api $path" "$api$path"
  done
  expect 404 "api POST /api/graphql" -X POST -H 'Content-Type: application/json' --data '{"query":"{__typename}"}' "$api/api/graphql"

  echo "== health"
  expect 200 "api /api/v1/health" "$api/api/v1/health"

  echo "== admin Origin"
  expect 403 "admin POST with Origin https://evil.example" "${access_headers[@]}" \
    -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example' \
    --data '{}' "$admin/api/librarians/login"
  # A wrong ADMIN_ORIGIN in caddy.env would answer 403 to every real login.
  expect 401 "admin POST login with its own Origin reaches Payload" "${access_headers[@]}" \
    -X POST -H 'Content-Type: application/json' -H "Origin: $admin_origin" \
    --data '{"email":"check@invalid.example","password":"not-a-real-password"}' "$admin/api/librarians/login"
}

if [[ "${SKIP_PUBLIC:-}" == 1 ]]; then
  echo "SKIP  public HTTP checks (no public admin/api records yet; in-network checks ran on the host)"
else
  public_checks
fi

if [[ "$target" == local ]]; then
  echo "== unknown host"
  expect 404 "Host foo.piviki.fi" -H 'Host: foo.piviki.fi' "http://127.0.0.1:${port}/"
  expect_login_page "$admin/admin/login"
  echo "== tunnel connectors"
  echo "SKIP  connector count (local)"
else
  echo "== tunnel connectors"
  body="$(curl -sS --max-time 20 -H "Authorization: Bearer ${CF_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/connections" || true)"
  count="$(jq -r 'if .success then (.result | length) else "error" end' <<<"$body" 2>/dev/null || echo error)"
  if [[ "$count" == 1 ]]; then pass "exactly one connector"; else fail "connector count: want 1, got $count"; fi
fi

echo
if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
