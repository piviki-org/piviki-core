#!/usr/bin/env bash
# Deploy checks (AD-5, AD-7, AD-17), run after every deploy against the target's own hosts:
#   1. admin is behind Access: an unauthenticated request is redirected to the Access login
#      (production/test). Nothing here passes Access; the admin-side checks (first-register 404,
#      Origin rules, login reachable) run behind it, in-network, in deploy.sh (host-checks.mjs).
#   2. api path allowlist: only /api/v1/* is served; everything else 404
#   3. /api/v1/health is 200
#   4. exactly one Tunnel connector (Cloudflare API); skipped for `local`
# For `local` (no Access), the admin-side checks run here too, plus unknown host 404.
#
# Usage: checks.sh local|production|test
#
# Environment for production/test (from the GitHub Environment):
#   ADMIN_HOST, API_HOST                 the target's host names
#   CF_API_TOKEN                         Cloudflare token with Tunnel read permission
#   CF_ACCOUNT_ID, CF_TUNNEL_ID          the target's Tunnel
# Before any request, every host given must agree with the target's name (AD-17): on test, a
# first label `test` or starting `test-`; on production, neither; on local, localhost names.
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

# The naming rule core applies to its origins (src/env.ts hostAgrees), on the hosts given here.
host_agrees() { # <environment> <host>
  local host="${2,,}" first
  host="${host%.}"
  first="${host%%.*}"
  case "$1" in
    test) [[ "$first" == test || "$first" == test-* ]] ;;
    production) [[ "$first" != test && "$first" != test-* ]] ;;
    local) [[ "$host" == localhost || "$host" == *.localhost ]] ;;
    *) return 1 ;;
  esac
}
for var in ADMIN_HOST API_HOST; do
  value="${!var:-}"
  [[ -z "$value" ]] && continue
  if ! host_agrees "$target" "$value"; then
    echo "FAIL  $var=$value is not a $target host name; no request sent" >&2
    exit 1
  fi
done

admin="${scheme}://${ADMIN_HOST:-}${host_port}"
api="${scheme}://${API_HOST:-}${host_port}"
admin_origin="${scheme}://${ADMIN_HOST:-}${host_port}"

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

# Access answers an unauthenticated request with a redirect to <team>.cloudflareaccess.com; the
# request never reaches the Tunnel. Anything else (200, a Payload page, 404 from Caddy) means
# admin is reachable without Access.
expect_access_redirect() {
  local got
  got="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$@" || true)"
  if [[ "$got" =~ ^30[237]\ https://[a-z0-9-]+\.cloudflareaccess\.com/ ]]; then
    pass "admin is behind Access (${got%% *} to ${got#* }); first-register, Origin and login ran in-network"
  else
    fail "admin without Access: want a redirect to *.cloudflareaccess.com, got $got"
  fi
}

# Only where nothing sits in front of Caddy (local): on hosted targets these run in-network.
admin_checks() {
  echo "== first-register"
  expect 404 "admin GET /admin/create-first-user" "$admin/admin/create-first-user"
  expect 404 "admin POST /api/librarians/first-register" \
    -X POST -H 'Content-Type: application/json' -H "Origin: $admin_origin" \
    --data '{"email":"check@invalid.example","password":"not-a-real-password"}' \
    "$admin/api/librarians/first-register"

  echo "== admin Origin"
  expect 403 "admin POST with Origin https://evil.example" \
    -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example' \
    --data '{}' "$admin/api/librarians/login"
  # A wrong ADMIN_ORIGIN in caddy.env would answer 403 to every real login.
  expect 401 "admin POST login with its own Origin reaches Payload" \
    -X POST -H 'Content-Type: application/json' -H "Origin: $admin_origin" \
    --data '{"email":"check@invalid.example","password":"not-a-real-password"}' "$admin/api/librarians/login"
}

public_checks() {
  if [[ "$target" == local ]]; then
    admin_checks
  else
    echo "== admin behind Access"
    expect_access_redirect "$admin/admin"
  fi

  echo "== api path allowlist"
  for path in / /admin /admin/login /api/librarians /api/librarians/me /api/librarians/first-register \
    /api/graphql /api/payload-jobs/run /api/v1 /api/v1/../librarians /api/v1/%2e%2e/librarians \
    /api/v1%2f..%2flibrarians; do
    expect 404 "api $path" "$api$path"
  done
  expect 404 "api POST /api/graphql" -X POST -H 'Content-Type: application/json' --data '{"query":"{__typename}"}' "$api/api/graphql"

  echo "== health"
  expect 200 "api /api/v1/health" "$api/api/v1/health"
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
