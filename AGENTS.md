<!-- bmad:context -->
<!-- Verified 2026-11-07 against e136304d819d6d408ce5c294dc882d74a095e015. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## piviki-core

Piviki's library catalogue core: Payload CMS on Next.js, Postgres, TypeScript, pnpm. `deploy/` holds everything a host runs for core: Compose, Caddy, the deploy script and its checks. Shared infrastructure (OpenTofu, the host bootstrap, runbooks, the secrets inventory) is the sibling repo `piviki-infra`. Architecture decisions are cited by AD number (e.g. AD-5, AD-17, AD-21).

## Policy

- Never push to `main`; open a PR, and a founder merges it.
- Name branches `<conventional-type>/<story>-<kebab-description>`, e.g. `fix/1.1-deploy-tree-label`.
- Write conventional commit messages whose body ends with a `Story X.Y.` line.
- Never run a deploy, `bootstrap.sh` or any command against a host; prepare the change and state what a founder runs.
- Never put a secret or an environment-specific value in a tracked file or the image; values live in `/etc/piviki/*.env` on the host and in Bitwarden.
- Change the pinned image digests in `deploy/compose.yml` only through Dependabot's PR or a bump a founder asked for.

## Where things are

- Collections: build every one with `defineCollection` (`src/collections/_helpers/defineCollection.ts`), which denies every operation not granted; never export a bare `CollectionConfig`.
- Runtime configuration: `src/env.ts`.
- Host runtime and the deploy rule: `deploy/README.md`.

## Running and verifying

- After any `deploy/` change, run `deploy/test/*.test.sh` (needs `jq`, `git`, `node`); `pnpm test` does not cover them, CI does.

## Conventions that differ from defaults

- Never hand-edit `src/payload-types.ts` or `src/app/(payload)/admin/importMap.js`; run `pnpm generate:types` or `pnpm generate:importmap`.
- Never edit an applied migration in `src/migrations/`; add a new one with `pnpm migrate:create`, since schema is only fixed forward.
- Add a new env var in all four places together: `src/env.ts`, `.env.example`, `deploy/env-manifest` when a host needs it, and `piviki-infra/docs/secrets-inventory.md`.
- Use host names that agree with `ENVIRONMENT`: test hosts start with `test` or `test-`, and local ones are `localhost` or `*.localhost` (tests use `admin.localhost`); core refuses to start otherwise.
- A change to a file the host reads in `deploy/` changes the host-runtime fingerprint (`deploy/fingerprint.sh`): say in the PR that the host needs `bootstrap.sh --move-core <merge commit>` before the tag deploys.
- Add a new `deploy/` file the host never reads to `fingerprint.sh`'s exclude list; never exclude a file the host reads.
- Never add a fetch, pull or edit of the checkout to `deploy.sh`; the host only moves when a founder runs `--move-core` (AD-21).

## Known pitfalls

- In workflow steps, assign a command's output to a variable and check it before writing to `$GITHUB_OUTPUT`; `echo "x=$(cmd)" >> "$GITHUB_OUTPUT"` doesn't fail when `cmd` fails.

<!-- /bmad:context -->
