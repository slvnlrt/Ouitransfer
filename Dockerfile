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
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.6.0 --activate
WORKDIR /app


# === SERVER DEPENDENCY STAGE ===
FROM base AS server-deps
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
# --ignore-scripts: skip root 'prepare' hook (lefthook install requires .git)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter ouitransfer-api


# === SERVER BUILD STAGE ===
FROM base AS server-builder
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
WORKDIR /app/apps/server
RUN pnpm exec prisma generate
RUN pnpm run build


# === SERVER PRODUCTION IMAGE ===
FROM node:24-alpine AS server-runner

RUN apk add --no-cache gcompat curl openssl su-exec

ENV NODE_ENV=production

# Create non-root user with fixed UID/GID (overridable at runtime via OUITRANSFER_UID/GID)
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs ouitransfer \
 && mkdir -p /home/ouitransfer/.npm /home/ouitransfer/.cache \
 && chown -R ouitransfer:nodejs /home/ouitransfer

# Application code directory (separate from /app/server data volume)
WORKDIR /app/ouitransfer-app

# Copy server production files
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/dist ./dist
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/node_modules ./node_modules
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/prisma ./prisma
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/package.json ./

# Shared packages (pnpm workspace symlinks resolve to ../../packages/shared)
COPY --from=server-builder --chown=ouitransfer:nodejs /app/packages ./../../packages

# Server startup script and config files
COPY --chown=ouitransfer:nodejs infra/server-start.sh /app/server-start.sh
COPY --chown=ouitransfer:nodejs infra/configs.json /app/infra/configs.json
COPY --chown=ouitransfer:nodejs infra/providers.json /app/infra/providers.json
COPY --chown=ouitransfer:nodejs infra/check-missing.js /app/infra/check-missing.js
RUN chmod +x /app/server-start.sh

# Reset password script
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/reset-password.sh ./reset-password.sh
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/src/scripts/ ./src/scripts/
RUN chmod +x ./reset-password.sh

# Seed file (accessible from data volume for bind mounts)
RUN mkdir -p /app/server/prisma
COPY --from=server-builder --chown=ouitransfer:nodejs /app/apps/server/prisma/seed.js /app/server/prisma/seed.js

EXPOSE 3333

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3333/health || exit 1

CMD ["/app/server-start.sh"]


# === WEB DEPENDENCY STAGE ===
FROM base AS web-deps
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
# --ignore-scripts: skip root 'prepare' hook (lefthook install requires .git)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter ouitransfer-web


# === WEB BUILD STAGE ===
FROM base AS web-builder
COPY --from=web-deps /app/node_modules ./node_modules
COPY --from=web-deps /app/apps/web/node_modules ./apps/web/node_modules
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm run build


# === WEB PRODUCTION IMAGE ===
FROM node:24-alpine AS web-runner

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5487
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app/web

# Copy Next.js standalone output
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/public ./public
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static

USER nextjs

EXPOSE 5487

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5487 || exit 1

CMD ["node", "server.js"]
