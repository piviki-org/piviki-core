#!/usr/bin/env bash
# deploy/checks.sh in production mode, without network: a fake curl answers by URL like Access,
# Caddy and Cloudflare's API would. Proves the admin check passes only when Access redirects to
# its login, that no request carries an Access service token, and that host names disagreeing
# with the target fail before any request.
# Run: deploy/test/checks-public.test.sh (needs jq, as checks.sh does).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
checks="$here/../checks.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT # only the folder this test created

cat >"$tmp/curl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
url="${*: -1}"
case "$url" in
  https://api.cloudflare.com/*) printf '{"success":true,"result":[{"id":"c1"}]}' ;;
  https://admin.example.test/* | https://test-admin.piviki.fi/*)
    case "$FAKE_ADMIN" in
      access) printf '302 https://piviki.cloudflareaccess.com/cdn-cgi/access/login/admin.example.test' ;;
      open) printf '200 ' ;;
      elsewhere) printf '302 https://evil.example/cloudflareaccess.com/' ;;
    esac ;;
  https://api.example.test/api/v1/health | https://test-api.piviki.fi/api/v1/health) printf '200' ;;
  https://api.example.test/* | https://test-api.piviki.fi/*) printf '404' ;;
  *) printf '000'; exit 6 ;;
esac
FAKE
chmod +x "$tmp/curl"

failed=0
check() { # <name> <want exit> <admin mode> [target] [admin host] [api host]
  local got=0
  : >"$tmp/log"
  FAKE_ADMIN="$3" FAKE_LOG="$tmp/log" PATH="$tmp:$PATH" \
    ADMIN_HOST="${5:-admin.example.test}" API_HOST="${6:-api.example.test}" \
    CF_API_TOKEN=tok CF_ACCOUNT_ID=acc CF_TUNNEL_ID=tun \
    "$checks" "${4:-production}" >"$tmp/out" 2>&1 || got=$?
  if [[ "$got" == "$2" ]]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1: exit $got, want $2"
    sed 's/^/      /' "$tmp/out"
    failed=1
  fi
}

check "admin redirected to the Access login passes" 0 access
if grep -qi 'CF-Access-Client' "$tmp/log"; then
  echo "FAIL  a request carried an Access service token"
  failed=1
else
  echo "PASS  no request carries an Access service token"
fi
check "admin answering without Access fails" 1 open
check "a redirect anywhere but cloudflareaccess.com fails" 1 elsewhere

# Host names that disagree with the target fail before any request (AD-17).
no_request() { # <name>
  if [[ -s "$tmp/log" ]]; then echo "FAIL  $1: a request was sent"; failed=1; else echo "PASS  $1"; fi
}
check "test with test host names passes" 0 access test test-admin.piviki.fi test-api.piviki.fi
check "test with a production admin host fails" 1 access test admin.piviki.fi test-api.piviki.fi
no_request "  ... before any request"
check "test with a production api host fails" 1 access test test-admin.piviki.fi api.piviki.fi
no_request "  ... before any request"
check "production with a test admin host fails" 1 access production test-admin.piviki.fi api.example.test
no_request "  ... before any request"
check "production with a test api host fails" 1 access production admin.example.test test.piviki.fi
no_request "  ... before any request"
# SKIP_PUBLIC (first deploy) still checks the names it is given.
: >"$tmp/log"
got=0
FAKE_LOG="$tmp/log" PATH="$tmp:$PATH" SKIP_PUBLIC=1 ADMIN_HOST=admin.piviki.fi \
  CF_API_TOKEN=tok CF_ACCOUNT_ID=acc CF_TUNNEL_ID=tun "$checks" test >"$tmp/out" 2>&1 || got=$?
if [[ "$got" == 1 ]] && grep -q 'ADMIN_HOST=admin.piviki.fi is not a test host' "$tmp/out"; then
  echo "PASS  SKIP_PUBLIC still refuses a disagreeing host"
else
  echo "FAIL  SKIP_PUBLIC with a disagreeing host: exit $got"; sed 's/^/      /' "$tmp/out"; failed=1
fi
no_request "  ... before any request"

exit "$failed"
