# syntax=docker/dockerfile:1.7
# piviki-core image: built only in CI (AD-17), never on a host.
# Two parts in one image:
#   /app/server  Next.js standalone output (Payload admin, generated REST API, /api/v1)
#   /app/tools   source + production dependencies, for `payload migrate` and the seed script
# Runs as the non-root `node` user and works on a read-only root filesystem
# (Compose mounts tmpfs on /tmp and /app/server/.next/cache).

ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && corepack install

FROM base AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
# Migrations and the seed script load only payload, db-postgres and tsx. Drop the UI and the
# Next.js compiler from this copy (the server part has its own traced copy) to halve its size.
RUN rm -rf node_modules/.pnpm/next@* node_modules/.pnpm/@next+swc-* node_modules/.pnpm/monaco-editor@* \
      node_modules/.pnpm/@payloadcms+ui@* node_modules/.pnpm/@payloadcms+next@* \
      node_modules/.pnpm/@img+sharp-* node_modules/.pnpm/react-dom@*

FROM deps AS build
COPY . .
# The image carries no configuration; src/env.ts tolerates missing values only in this phase.
RUN pnpm build

FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--no-deprecation \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=root:root /app/.next/standalone ./server
COPY --from=build --chown=root:root /app/.next/static ./server/.next/static

COPY --from=prod-deps --chown=root:root /app/node_modules ./tools/node_modules
COPY --chown=root:root package.json tsconfig.json ./tools/
COPY --chown=root:root src ./tools/src
COPY --chown=root:root scripts ./tools/scripts

COPY --chown=root:root --chmod=0755 docker/entrypoint.sh /usr/local/bin/piviki-core

# Files stay root-owned and read-only to the runtime user.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/piviki-core"]
CMD ["start"]
