#!/usr/bin/env bash
# deploy/checks.sh in production mode, without network: a fake curl answers by URL like Access,
# Caddy and Cloudflare's API would. Proves the admin check passes only when Access redirects to
# its login, and that no request carries an Access service token.
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
  https://admin.example.test/*)
    case "$FAKE_ADMIN" in
      access) printf '302 https://piviki.cloudflareaccess.com/cdn-cgi/access/login/admin.example.test' ;;
      open) printf '200 ' ;;
      elsewhere) printf '302 https://evil.example/cloudflareaccess.com/' ;;
    esac ;;
  https://api.example.test/api/v1/health) printf '200' ;;
  https://api.example.test/*) printf '404' ;;
  *) printf '000'; exit 6 ;;
esac
FAKE
chmod +x "$tmp/curl"

failed=0
check() { # <name> <want exit> <admin mode>
  local got=0
  : >"$tmp/log"
  FAKE_ADMIN="$3" FAKE_LOG="$tmp/log" PATH="$tmp:$PATH" \
    ADMIN_HOST=admin.example.test API_HOST=api.example.test \
    CF_API_TOKEN=tok CF_ACCOUNT_ID=acc CF_TUNNEL_ID=tun \
    "$checks" production >"$tmp/out" 2>&1 || got=$?
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

exit "$failed"
