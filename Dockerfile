# ==============================================================================
# Ouitransfer — Multi-target Dockerfile
#
# Build targets:
#   server-runner — Fastify API server
#   web-runner    — Next.js frontend
#
# Usage:
#   docker compose build                          (builds both)
#   docker build --target server-runner -t ...     (server only)
#   docker build --target web-runner -t ...        (web only)
# ==============================================================================

# === SHARED BUILD BASE ===
FROM node:24.16.0-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
# pnpm 11 verifies dependency sync before exec/run and triggers a full implicit
# `pnpm install` when any workspace member has stale/missing node_modules.
# In Docker builds only the target package is installed (--filter), so the check
# always fires and runs lifecycle scripts for packages whose source files aren't
# present — causing cascading failures.  Disable only in Docker context.
ENV pnpm_config_verify_deps_before_run=false
WORKDIR /app


# === SERVER DEPENDENCY STAGE ===
FROM base AS server-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
# --ignore-scripts: skip root 'prepare' hook (lefthook install requires .git)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter ouitransfer-api


# === SHARED PACKAGES BUILD STAGE ===
# Webpack (Next.js) resolves the "default" export condition → dist/mime-types.js.
# .dockerignore correctly excludes **/dist, so we must build from source in Docker.
FROM base AS shared-builder
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ouitransfer/shared
COPY packages/ ./packages/
RUN pnpm --filter @ouitransfer/shared run build


# === SERVER BUILD STAGE ===
FROM base AS server-builder
# Build tools for native modules (better-sqlite3 prebuild fallback)
RUN apk add --no-cache python3 make g++
# Workspace context (pnpm deploy needs workspace config at root)
COPY --from=server-deps /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
# Reuse pnpm content-addressable store so deploy doesn't re-download
COPY --from=server-deps /root/.local/share/pnpm/store /root/.local/share/pnpm/store
COPY --from=shared-builder /app/packages ./packages/
COPY apps/server/ ./apps/server/
# Also need other apps' package.json for pnpm workspace validation
COPY apps/web/package.json ./apps/web/package.json
COPY apps/docs/package.json ./apps/docs/package.json
WORKDIR /app/apps/server
RUN pnpm exec prisma generate
RUN pnpm run build
# Create standalone production deployment:
# - Flat node_modules (no pnpm symlinks — works at any path)
# - Workspace packages resolved as real directories
# - Only production dependencies
WORKDIR /app
RUN pnpm --filter ouitransfer-api deploy --legacy --prod --ignore-scripts /app/deploy
# Post-deploy: rebuild native modules and generate Prisma client
# (both skipped by --ignore-scripts during deploy)
WORKDIR /app/deploy
RUN npm rebuild better-sqlite3 \
    || (echo "Retry 1/2 in 10s..." && sleep 10 && npm rebuild better-sqlite3) \
    || (echo "Retry 2/2 in 20s..." && sleep 20 && npm rebuild better-sqlite3)
RUN node node_modules/prisma/build/index.js generate


# === SERVER PRODUCTION IMAGE ===
FROM node:24.16.0-alpine AS server-runner

RUN apk add --no-cache gcompat curl openssl su-exec

ENV NODE_ENV=production

# Create non-root user with fixed UID/GID (overridable at runtime via OUITRANSFER_UID/GID)
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs ouitransfer \
 && mkdir -p /home/ouitransfer/.npm /home/ouitransfer/.cache \
 && chown -R ouitransfer:nodejs /home/ouitransfer

# A8-09: pre-create the data directory tree owned by the non-root user. Docker
# pre-populates a NAMED volume from the image content (incl. ownership) on first
# mount, so the `server_data` volume mounted at /app/server inherits this
# ouitransfer:nodejs ownership — no root chown is needed at runtime. The entrypoint
# therefore runs entirely as the non-root `ouitransfer` user (see USER below),
# eliminating the previous root window. A host bind-mount (Traefik example) is the
# only case still needing a root pre-chown; that example documents it explicitly.
RUN mkdir -p /app/server/prisma /app/server/uploads /app/server/temp-uploads \
 && chown -R ouitransfer:nodejs /app/server

# Application code from pnpm deploy (flat node_modules, no pnpm symlinks)
WORKDIR /app/ouitransfer-app
COPY --from=server-builder --chown=ouitransfer:nodejs /app/deploy ./

# Server startup script
COPY --chown=ouitransfer:nodejs infra/server-start.sh /app/server-start.sh
RUN chmod +x /app/server-start.sh
RUN chmod +x ./reset-password.sh

# A8-09: drop to the non-root user for the entrypoint and the node process. The
# data volume is pre-owned (above), so no root-time chown is required.
USER ouitransfer

EXPOSE 3333

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3333/health || exit 1

CMD ["/app/server-start.sh"]


# === WEB DEPENDENCY STAGE ===
FROM base AS web-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
# --ignore-scripts: skip root 'prepare' hook (lefthook install requires .git)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter ouitransfer-web


# === WEB BUILD STAGE ===
FROM base AS web-builder
# Workspace context (pnpm needs pnpm-workspace.yaml to resolve catalog: specifiers)
COPY --from=web-deps /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=web-deps /app/node_modules ./node_modules
COPY --from=web-deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=shared-builder /app/packages ./packages/
COPY apps/web/ ./apps/web/
WORKDIR /app/apps/web
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm run build


# === WEB PRODUCTION IMAGE ===
FROM node:24.16.0-alpine AS web-runner

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5487
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

# Copy Next.js standalone output (outputFileTracingRoot = monorepo root,
# so standalone/ mirrors the full monorepo structure with real files)
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 5487

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5487 || exit 1

CMD ["node", "apps/web/server.js"]


# === DOCS DEPENDENCY STAGE ===
FROM base AS docs-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
# --ignore-scripts: skip root 'prepare' hook (lefthook) and the docs 'postinstall'
# (fumadocs-mdx); the latter is run explicitly in the build stage where sources exist.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter ouitransfer-docs


# === DOCS BUILD STAGE ===
FROM base AS docs-builder
# Workspace context (pnpm needs pnpm-workspace.yaml to resolve catalog: specifiers)
COPY --from=docs-deps /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=docs-deps /app/node_modules ./node_modules
COPY --from=docs-deps /app/apps/docs/node_modules ./apps/docs/node_modules
# packages/ provides the @ouitransfer/config tsconfig preset extended by apps/docs.
COPY --from=shared-builder /app/packages ./packages/
COPY apps/docs/ ./apps/docs/
WORKDIR /app/apps/docs
# Base path baked into the build. Default "/docs" (path-prefix deployment behind a
# reverse proxy). Pass an empty string to build for a sub-domain (no prefix).
ARG NEXT_PUBLIC_DOCS_BASE_PATH=/docs
ENV NEXT_PUBLIC_DOCS_BASE_PATH=$NEXT_PUBLIC_DOCS_BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Generate the fumadocs `.source` module (normally the postinstall hook, skipped above)
RUN pnpm exec fumadocs-mdx
RUN pnpm run build


# === DOCS PRODUCTION IMAGE ===
FROM node:24.16.0-alpine AS docs-runner

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5488
ENV HOSTNAME=0.0.0.0
# Mirrors the build-time base path so the healthcheck targets the right route.
ARG NEXT_PUBLIC_DOCS_BASE_PATH=/docs
ENV NEXT_PUBLIC_DOCS_BASE_PATH=$NEXT_PUBLIC_DOCS_BASE_PATH

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

# Copy Next.js standalone output (outputFileTracingRoot = monorepo root,
# so standalone/ mirrors the full monorepo structure with real files)
COPY --from=docs-builder --chown=nextjs:nodejs /app/apps/docs/.next/standalone ./
COPY --from=docs-builder --chown=nextjs:nodejs /app/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=docs-builder --chown=nextjs:nodejs /app/apps/docs/public ./apps/docs/public

USER nextjs

EXPOSE 5488

# basePath means the app does not serve "/", so probe the base path root.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f "http://localhost:5488${NEXT_PUBLIC_DOCS_BASE_PATH}" || exit 1

CMD ["node", "apps/docs/server.js"]
