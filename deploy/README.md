# deploy/: core's host runtime

What a Piviki host runs for core (AD-21). Each host has a root-owned checkout of this repository
at `/opt/piviki/core`, placed and moved only by a founder with the
[`piviki-infra`](https://github.com/piviki-org/piviki-infra) bootstrap. Moving it is the only
way this folder changes on a host. A deploy names only the image tag.

| File | Role |
|---|---|
| `compose.yml` | The stack: cloudflared, caddy, core, postgres. Non-core images pinned by tag and digest |
| `caddy/Caddyfile` | Host and path rules; every host name comes from `caddy.env` |
| `postgres-init/10-core-role.sh` | Creates the non-superuser role core connects as (first start only) |
| `env-manifest` | Exactly the env files under `/etc/piviki` and their keys; the bootstrap creates them from it |
| `deploy.sh` | The deploy user's only command (sudoers names this file in the checkout) |
| `host-checks.mjs` | In-network checks `deploy.sh` runs after each deploy |
| `checks.sh` | Checks the deploy workflow runs: public URLs and the Tunnel connector count |
| `piviki-compose` | Founder helper on a host (`/usr/local/sbin/piviki-compose` links here) |
| `compose.local.yml`, `local-env/` | The local stack only; fake values |

## The rule a deploy enforces

`deploy.sh` refuses a tag `<commit>-<date>` unless the checkout is clean **and** its `deploy/` is
identical to `deploy/` at `<commit>`. So:

- **A change only to the app** (no change under `deploy/`): deploy the new tag. The checkout stays
  where it is.
- **A change under `deploy/`** (Compose, Caddy, checks, manifest, an image digest): after the PR
  is merged and built, a founder moves the checkout, then deploys:
  ```sh
  sudo /opt/piviki/infra/bootstrap/bootstrap.sh --move-core <commit>
  ```
  Moving waits for any running deploy (they share a lock) and does not touch the running stack.
- **A rollback** to a tag whose `deploy/` differs: move the checkout to that tag's commit first,
  then deploy the tag.

If the manifest gains a file or key, re-run the full bootstrap after moving, so the empty
entry is created, and fill it from Bitwarden before deploying.

## One environment name per host

The host's environment name lives only in `/etc/piviki/environment` (written by the bootstrap).
`deploy.sh` writes it as `ENVIRONMENT` next to `CORE_TAG` in `/var/lib/piviki/compose.env`,
and Compose passes it to core; no env file repeats it. Host names must agree with it (AD-17):

| Environment | Every host in `SERVER_URL`, `CORS_ORIGINS`, `CSRF_ORIGINS` (core) and `ADMIN_HOST`, `API_HOST` (checks) |
|---|---|
| `test` | first label `test` or starting `test-` (`test-admin.piviki.fi`) |
| `production` | first label neither `test` nor starting `test-` |
| `local` | `localhost` or `*.localhost` |

Core refuses to load its configuration on a disagreeing value and names it, so a deploy fails
at its migrations step (`core migrate`, before the new core starts) and the tag is not recorded;
`host-checks.mjs` (also on `ADMIN_ORIGIN`) and `checks.sh` fail before sending any request.

## Local stack (needs Docker)

```sh
cd deploy
export CORE_TAG=local ENVIRONMENT=local   # compose.yml requires both; deploy.sh sets them on a host
dc() { docker compose -f compose.yml -f compose.local.yml "$@"; }
dc build core
dc up -d --wait postgres
dc run --rm --no-deps -T core migrate      # as deploy.sh does, before core starts
dc up -d --wait
./checks.sh local
```

It builds core from this repository, reads `local-env/` instead of `/etc/piviki/`, publishes
Caddy on `127.0.0.1:8080` and runs no Tunnel. Then open `http://admin.localhost:8080/admin`.
