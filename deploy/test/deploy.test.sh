#!/usr/bin/env bash
# deploy.sh's refusals and recording (AD-21), with docker faked and a throwaway git repo standing
# in for the host checkout at /opt/piviki/core. No Docker, network or root needed.
# Run: deploy/test/deploy.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT # only the folder this test created
mkdir -p "$tmp"/{repo,etc,state,bin}

# Fake docker: logs every call; the in-network checks fail when FAKE_CHECKS_FAIL=1.
cat >"$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"
if [[ "${FAKE_CHECKS_FAIL:-}" == 1 && "$*" == *checks.mjs* ]]; then exit 1; fi
exit 0
FAKE
chmod +x "$tmp/bin/docker"

# The checkout: c1 (base), c2 (app change only, HEAD), c3 (deploy/ change, not checked out).
repo="$tmp/repo"
cp -a "$src" "$repo/deploy"
rm -rf "$repo/deploy/test"
g() { git -C "$repo" -c user.email=test@example.invalid -c user.name=test "$@"; }
g init -q
g add -A && g commit -qm c1
c1="$(g rev-parse --short=12 HEAD)"
echo change >"$repo/app.txt" && g add -A && g commit -qm c2-app
c2="$(g rev-parse --short=12 HEAD)"
echo '# change' >>"$repo/deploy/compose.yml" && g commit -qam c3-deploy
c3="$(g rev-parse --short=12 HEAD)"
g -c advice.detachedHead=false checkout -q --detach "$c2"

# /etc/piviki filled from the manifest, every value set (the optional ghcr.env stays empty).
echo production >"$tmp/etc/environment"
fill_env() {
  local file keys key
  rm -f "$tmp"/etc/*.env
  while read -r file keys; do
    [[ -z "$file" || "$file" == \#* ]] && continue
    for key in $keys; do
      if [[ "$file" == *\? ]]; then echo "${key%%=*}=" >>"$tmp/etc/${file%\?}"
      else echo "${key%%=*}=value" >>"$tmp/etc/$file"; fi
    done
  done <"$repo/deploy/env-manifest"
}
fill_env

d="$(date -u +%Y%m%d)"
failed=0
run() { # <name> <want exit> <ssh command>
  local name="$1" want="$2" got=0
  PATH="$tmp/bin:$PATH" FAKE_DOCKER_LOG="$tmp/docker.log" PIVIKI_DEPLOY_TEST=1 \
    PIVIKI_ETC_DIR="$tmp/etc" PIVIKI_STATE_DIR="$tmp/state" PIVIKI_LOCK="$tmp/lock" \
    bash "$repo/deploy/deploy.sh" "$3" >"$tmp/out" 2>&1 || got=$?
  if [[ "$got" == "$want" ]]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name: exit $got, want $want"
    sed 's/^/      /' "$tmp/out"
    failed=1
  fi
}
recorded() { sed -n 's/^CORE_TAG=//p' "$tmp/state/compose.env" 2>/dev/null; }
history_lines() { wc -l <"$tmp/state/deploys.log" 2>/dev/null || echo 0; }
expect_recorded() { # <name> <tag> <history lines>
  if [[ "$(recorded)" == "$2" && "$(history_lines | tr -d ' ')" == "$3" ]]; then echo "PASS  $1"
  else echo "FAIL  $1: recorded '$(recorded)', history $(history_lines), want '$2', $3"; failed=1; fi
}

run "older commit with the same deploy/ deploys" 0 "deploy production $c1-$d"
expect_recorded "  ... and is recorded" "$c1-$d" 1
run "HEAD deploys" 0 "deploy production $c2-$d"
expect_recorded "  ... and is recorded, with the checkout commit in the history" "$c2-$d" 2
if grep -q "previous=$c1-$d	checkout=$c2" "$tmp/state/deploys.log"; then echo "PASS  history names previous and checkout"
else echo "FAIL  history line"; failed=1; fi

if grep -qx "ENVIRONMENT=production" "$tmp/state/compose.env"; then
  echo "PASS  the recorded state passes the host's environment name to Compose"
else
  echo "FAIL  compose.env has no ENVIRONMENT=production"; failed=1
fi
if grep -q "checks.mjs" "$tmp/docker.log" && grep "checks.mjs" "$tmp/docker.log" | grep -q -- "-e ENVIRONMENT=production"; then
  echo "PASS  the in-network checks get the host's environment name"
else
  echo "FAIL  host-checks.mjs ran without ENVIRONMENT=production"; failed=1
fi

run "a commit whose deploy/ differs is refused" 1 "deploy production $c3-$d"
grep -q "deploy/ at $c3 differs" "$tmp/out" || { echo "FAIL  refusal names the deploy/ mismatch"; failed=1; }
run "an unknown commit is refused" 1 "deploy production abcdefabcdef-$d"
run "a malformed tag is refused" 1 "deploy production $c2"
run "another environment is refused" 1 "deploy test $c2-$d"

echo stray >"$repo/untracked.txt"
run "a dirty checkout is refused" 1 "deploy production $c2-$d"
rm "$repo/untracked.txt"

sed -i 's/^TUNNEL_TOKEN=.*/TUNNEL_TOKEN=/' "$tmp/etc/cloudflared.env"
run "an empty required value is refused" 1 "deploy production $c2-$d"
fill_env
sed -i '/^PIVIKI_CORE_DB_PASSWORD=/d' "$tmp/etc/postgres.env"
run "a missing key is refused" 1 "deploy production $c2-$d"
fill_env
expect_recorded "refusals record nothing" "$c2-$d" 2

FAKE_CHECKS_FAIL=1 run "failing in-network checks fail the deploy" 1 "deploy production $c1-$d"
grep -q "NOT recorded" "$tmp/out" || { echo "FAIL  the failure says the tag is not recorded"; failed=1; }
expect_recorded "  ... and leave the recorded tag and history unchanged" "$c2-$d" 2

run "status names environment, tag and checkout" 0 "status"
if ! grep -qx "checkout=$c2" "$tmp/out" || ! grep -qx "tag=$c2-$d" "$tmp/out"; then echo "FAIL  status output"; failed=1; fi

exit "$failed"
