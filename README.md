# piviki-core

Payload CMS 3 on Next.js: the librarian admin at `admin.piviki.fi` and the public API under
`api.piviki.fi/api/v1`. Its host runtime (Compose, Caddy, the deploy script and its checks) is in
[`deploy/`](deploy/README.md); shared infrastructure is in
[`piviki-infra`](https://github.com/piviki-org/piviki-infra).

## Requirements

- Node 24 (`.node-version`) and pnpm through corepack (`corepack enable`; the version is pinned in
  `package.json`).
- Docker with the Compose plugin, for the local stack only.

## Commands

| Command | Needs | Does |
|---|---|---|
| `pnpm install --frozen-lockfile` | | Dependencies |
| `pnpm typecheck` | | TypeScript |
| `pnpm test` | | Tests on a real Postgres 18 that the tests start themselves (embedded-postgres) |
| `deploy/test/checks-connector.test.sh`, `deploy/test/deploy.test.sh` | `jq`, `git` | Deploy-script tests, Docker and network faked |
| `pnpm build` | | Production build (no configuration needed) |
| local stack, see [`deploy/README.md`](deploy/README.md) | Docker | The image behind Caddy on `http://admin.localhost:8080` |

## Running against your own Postgres

`pnpm dev` reads its configuration from the environment (`.env.example` lists every variable). It
needs a Postgres you provide, with the role and database named in `DATABASE_URL`; nothing here
creates them. The local stack is usually simpler: it creates both and runs the built image.

Every librarian account starts from `pnpm seed:librarian` (email and password on stdin); there is
no public sign-up (AD-5).

## License

MIT. See [LICENSE](LICENSE).
