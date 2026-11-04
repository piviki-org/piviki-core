#!/usr/bin/env bash
# The Tunnel connector-count check in deploy/checks.sh, without network or a Cloudflare account:
# a fake curl first on PATH returns prepared Cloudflare API replies. Only exactly one connector
# may pass; zero, two, an API error, a non-JSON reply and a curl failure must all fail.
# Run: deploy/test/checks-connector.test.sh (needs jq, as checks.sh does).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
checks="$here/../checks.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT # only the folder this test created

# Fake curl: records its arguments, prints $FAKE_BODY, exits $FAKE_EXIT.
cat >"$tmp/curl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
printf '%s' "$FAKE_BODY"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/curl"

conn='{"id":"c1","colo_name":"hel01"}'
failed=0

# check <name> <want exit> <reply body> [curl exit]
check() {
  local name="$1" want="$2" got=0
  : >"$tmp/log"
  FAKE_BODY="$3" FAKE_EXIT="${4:-0}" FAKE_LOG="$tmp/log" PATH="$tmp:$PATH" \
    SKIP_PUBLIC=1 CF_API_TOKEN=tok CF_ACCOUNT_ID=acc CF_TUNNEL_ID=tun \
    "$checks" production >"$tmp/out" 2>&1 || got=$?
  if [[ "$got" == "$want" ]]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name: exit $got, want $want"
    sed 's/^/      /' "$tmp/out"
    failed=1
  fi
}

check "one connector passes" 0 "{\"success\":true,\"result\":[$conn]}"
check "no connector fails" 1 '{"success":true,"result":[]}'
check "two connectors fail" 1 "{\"success\":true,\"result\":[$conn,$conn]}"
check "API success:false fails" 1 '{"success":false,"errors":[{"code":10000}],"result":null}'
check "non-JSON reply fails" 1 '<html>502 Bad Gateway</html>'
check "curl failure fails" 1 '' 7

# The last run's request: the right endpoint, with the token.
if grep -qF 'https://api.cloudflare.com/client/v4/accounts/acc/cfd_tunnel/tun/connections' "$tmp/log" &&
  grep -qF 'Authorization: Bearer tok' "$tmp/log"; then
  echo "PASS  asks the Tunnel connections endpoint with the token"
else
  echo "FAIL  wrong URL or header:"
  sed 's/^/      /' "$tmp/log"
  failed=1
fi

exit "$failed"
