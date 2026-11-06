#!/usr/bin/env bash
# piviki-deploy: the deploy user's only command (sshd ForceCommand -> sudo, see the piviki-infra
# bootstrap). It runs from the root-owned piviki-core checkout (AD-21), at
# /opt/piviki/core/deploy/deploy.sh; sudoers names that path. The SSH command line arrives as $1:
#   deploy <environment> <tag>   pull the tag, run migrations, start it, record it
#   checks                       re-run the in-network checks against the running stack
#   status                       print the environment, the recorded tag and the checkout commit
# Only pulls images: nothing is ever built on a host (AD-17). It never fetches, pulls or edits the
# checkout: a tag is refused unless the checkout is clean and its deploy/ matches the tag's commit.
set -euo pipefail
umask 022

# The checkout this script lives in (…/deploy/deploy.sh -> …).
CORE_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd -P)"
DEPLOY_DIR="$CORE_DIR/deploy"
# PIVIKI_* overrides exist only for deploy/test/deploy.test.sh; sudo's env_reset (set explicitly
# for the deploy user by the bootstrap) strips them from every real invocation.
ETC_DIR="${PIVIKI_ETC_DIR:-/etc/piviki}"
STATE_DIR="${PIVIKI_STATE_DIR:-/var/lib/piviki}"
STATE_FILE="$STATE_DIR/compose.env"
HISTORY="$STATE_DIR/deploys.log"
LOCK="${PIVIKI_LOCK:-/run/lock/piviki-deploy.lock}"
IMAGE=ghcr.io/piviki-org/piviki-core
COMPOSE_FILE="$DEPLOY_DIR/compose.yml"
MANIFEST="$DEPLOY_DIR/env-manifest"
TAG_RE='^[0-9a-f]{12}-[0-9]{8}$'

die() { printf 'piviki-deploy: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 || -n "${PIVIKI_DEPLOY_TEST:-}" ]] || die "must run as root via sudo"
host_env="$(cat "$ETC_DIR/environment" 2>/dev/null || true)"
[[ "$host_env" == production || "$host_env" == test ]] || die "host environment not set; run bootstrap"

# Split the single SSH command string into words without any shell evaluation.
read -r -a argv <<<"${1:-}"
cmd="${argv[0]:-}"

compose() {
  docker compose --env-file "$1" -f "$COMPOSE_FILE" "${@:2}"
}

current_tag() {
  sed -n 's/^CORE_TAG=//p' "$STATE_FILE" 2>/dev/null || true
}

git_core() { git -c safe.directory="$CORE_DIR" -C "$CORE_DIR" "$@"; }

checkout_commit() { git_core rev-parse --short=12 HEAD 2>/dev/null || echo unknown; }

# AD-21: the checkout must be clean, and its deploy/ identical to the deploy/ of the tag's commit.
# A founder moves the checkout first (piviki-infra bootstrap.sh --move-core <commit>), also
# before a rollback to an older tag.
require_matching_checkout() {
  local commit="${1%%-*}" full dirty
  dirty="$(git_core status --porcelain --untracked-files=all)" || die "$CORE_DIR is not a git checkout"
  [[ -z "$dirty" ]] || die "the checkout at $CORE_DIR has local changes; a founder restores it first"
  full="$(git_core rev-parse --verify --quiet "${commit}^{commit}")" ||
    die "commit $commit is not in the checkout at $CORE_DIR (HEAD $(checkout_commit)); a founder moves the checkout first: bootstrap.sh --move-core $commit"
  git_core diff --quiet "$full" HEAD -- deploy/ ||
    die "deploy/ at $commit differs from the checkout (HEAD $(checkout_commit)); a founder moves the checkout first: bootstrap.sh --move-core $commit"
}

# Every env file and key the manifest lists must exist with a value, except in a file marked
# optional (`name?`). An empty value would, for example, abort Postgres's one-time init script on
# a volume that then never re-runs it.
require_env_files() {
  local file keys key name optional
  while read -r file keys; do
    [[ -z "$file" || "$file" == \#* ]] && continue
    name="${file%\?}"
    optional=false
    [[ "$name" != "$file" ]] && optional=true
    [[ -f "$ETC_DIR/$name" ]] || die "$ETC_DIR/$name is missing; re-run the bootstrap"
    for key in $keys; do
      key="${key%%=*}"
      grep -q "^${key}=" "$ETC_DIR/$name" || die "$ETC_DIR/$name has no ${key}= line"
      $optional || grep -q "^${key}=." "$ETC_DIR/$name" || die "$ETC_DIR/$name: ${key} is empty; fill it from Bitwarden"
    done
  done <"$MANIFEST"
}

# In-network checks through Caddy with each host's Host header (host-checks.mjs), using the
# deployed core image's node. Works before the public admin/api records exist.
host_checks() {
  local tag="$1" caddy_env="$ETC_DIR/caddy.env"
  docker run --rm --network piviki_edge --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -v "$DEPLOY_DIR/host-checks.mjs:/checks.mjs:ro" \
    -e ENVIRONMENT="$host_env" \
    -e ADMIN_HOST="$(sed -n 's/^ADMIN_HOST=//p' "$caddy_env")" \
    -e API_HOST="$(sed -n 's/^API_HOST=//p' "$caddy_env")" \
    -e ADMIN_ORIGIN="$(sed -n 's/^ADMIN_ORIGIN=//p' "$caddy_env")" \
    --entrypoint node "$IMAGE:$tag" /checks.mjs
}

case "$cmd" in
  checks)
    [[ ${#argv[@]} -eq 1 ]] || die "usage: checks"
    tag="$(current_tag)"
    [[ -n "$tag" ]] || die "nothing deployed yet"
    host_checks "$tag"
    ;;

  status)
    [[ ${#argv[@]} -eq 1 ]] || die "usage: status"
    printf 'environment=%s\ntag=%s\ncheckout=%s\n' "$host_env" "$(current_tag)" "$(checkout_commit)"
    ;;

  deploy)
    [[ ${#argv[@]} -eq 3 ]] || die "usage: deploy <environment> <tag>"
    want_env="${argv[1]}"
    tag="${argv[2]}"
    [[ "$want_env" == "$host_env" ]] || die "this host is '$host_env', refusing a deploy for '$want_env'"
    [[ "$tag" =~ $TAG_RE ]] || die "tag must look like <12-hex-commit>-<YYYYMMDD>"

    # The same lock as bootstrap.sh --move-core: the checkout cannot move during a deploy.
    exec 9>"$LOCK"
    flock -n 9 || die "another deploy or a checkout move is running"

    require_matching_checkout "$tag"
    require_env_files

    previous="$(current_tag)"
    next_state="$(mktemp "$STATE_DIR/compose.env.XXXXXX")"
    trap 'rm -f "$next_state"' EXIT
    # The environment name has one source, /etc/piviki/environment; Compose passes it to core,
    # which refuses host names that disagree with it (AD-17).
    printf 'CORE_TAG=%s\nENVIRONMENT=%s\n' "$tag" "$host_env" >"$next_state"

    if [[ -s "$ETC_DIR/ghcr.env" ]] && grep -q '^GHCR_TOKEN=.' "$ETC_DIR/ghcr.env"; then
      GHCR_USER="$(sed -n 's/^GHCR_USER=//p' "$ETC_DIR/ghcr.env")"
      sed -n 's/^GHCR_TOKEN=//p' "$ETC_DIR/ghcr.env" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
    fi

    echo "== pull $IMAGE:$tag"
    compose "$next_state" pull --quiet

    echo "== database"
    compose "$next_state" up -d --wait postgres

    echo "== migrations (before the new core starts)"
    compose "$next_state" run --rm --no-deps -T core migrate

    echo "== start"
    compose "$next_state" up -d --wait --remove-orphans

    echo "== in-network checks"
    host_checks "$tag" || die "checks failed; tag $tag is running but NOT recorded. Redeploy ${previous:-a good tag} to roll back."

    echo "== record"
    mv "$next_state" "$STATE_FILE"
    trap - EXIT
    chmod 0644 "$STATE_FILE"
    printf '%s\t%s\t%s\tprevious=%s\tcheckout=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host_env" "$tag" "${previous:-none}" "$(checkout_commit)" >>"$HISTORY"
    docker image prune -f --filter "until=720h" >/dev/null || true

    printf 'deployed environment=%s tag=%s previous=%s\n' "$host_env" "$tag" "${previous:-none}"
    ;;

  *)
    die "usage: deploy <environment> <tag> | checks | status"
    ;;
esac
