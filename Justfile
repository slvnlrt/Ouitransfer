# Justfile for Ouitransfer
# Usage: just <recipe>  |  just --list
# Install just: https://just.systems/man/en/

# Load dev environment variables (DATABASE_URL, JWT_SECRET, etc.) for local CLI tools
set dotenv-path := "apps/server/.env.development"

# Default recipe — list available commands
default:
    @just --list

# ─── Development ─────────────────────────────────────────────────────────────

# Run all apps in dev mode (turbo). Requires a local SQLite DB — run 'just db-dev-init' first.
[linux]
[macos]
dev:
    #!/usr/bin/env sh
    if [ ! -f apps/server/prisma/ouitransfer.db ]; then
      printf '\nERROR: Local database not found. The API server needs a SQLite DB.\n  Run: just db-dev-init\n\n'
      exit 1
    fi
    pnpm dev

[windows]
dev:
    @[ -f apps/server/prisma/ouitransfer.db ] || { printf '\nERROR: Local database not found. Run: just db-dev-init\n\n'; exit 1; }
    pnpm dev

# Run API server only. Requires a local SQLite DB — run 'just db-dev-init' first.
[linux]
[macos]
dev-server:
    #!/usr/bin/env sh
    if [ ! -f apps/server/prisma/ouitransfer.db ]; then
      printf '\nERROR: Local database not found.\n  Run: just db-dev-init\n\n'
      exit 1
    fi
    pnpm dev:server

[windows]
dev-server:
    @[ -f apps/server/prisma/ouitransfer.db ] || { printf '\nERROR: Local database not found. Run: just db-dev-init\n\n'; exit 1; }
    pnpm dev:server

# Run web frontend only (no DB required)
dev-web:
    pnpm dev:web

# Run docs site only (no DB required)
dev-docs:
    pnpm dev:docs

# ─── Quality ─────────────────────────────────────────────────────────────────

# Lint all packages (Biome)
lint:
    pnpm lint

# Format all packages and apply fixes (Biome)
format:
    pnpm format

# TypeScript type-check across all packages
type-check:
    pnpm type-check

# Run full validation pipeline (lint + type-check + test)
validate:
    pnpm validate

# Run unit/integration tests
test:
    pnpm test

# Run tests with coverage report
test-coverage:
    pnpm -r run test:coverage

# Run Playwright E2E tests (headless)
e2e:
    pnpm e2e

# Run Playwright E2E tests with interactive UI
e2e-ui:
    pnpm e2e:ui

# Detect dead code and unused exports (Knip)
knip:
    pnpm knip

# ─── Database (Prisma) ───────────────────────────────────────────────────────

# Generate Prisma client after schema changes
db-generate:
    pnpm --filter=ouitransfer-api exec prisma generate

# Apply pending migrations (production / staging)
db-migrate:
    pnpm --filter=ouitransfer-api run db:migrate

# Create and apply a new migration (development only)
db-migrate-dev:
    pnpm --filter=ouitransfer-api exec prisma migrate dev

# Open Prisma Studio (visual database browser)
db-studio:
    pnpm --filter=ouitransfer-api exec prisma studio

# Seed the database with initial data
db-seed:
    pnpm --filter=ouitransfer-api run db:seed

# Reset database: drop all data and re-run migrations — DEV ONLY
db-reset:
    pnpm --filter=ouitransfer-api exec prisma migrate reset

# Initialize local dev SQLite database (one-time, no S3 required)
# Creates apps/server/prisma/ouitransfer.db from the schema and seeds it
db-dev-init:
    pnpm --filter=ouitransfer-api exec prisma db push
    pnpm --filter=ouitransfer-api run db:seed

# ─── Docker / Production ─────────────────────────────────────────────────────

# Build both Docker images locally (single-arch, current platform only)
docker-build:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml build

# Build and push multi-platform images — usage: just docker-push [tag]
docker-push tag="latest":
    @echo "Building and pushing ouitransfer images (tag: {{tag}})..."
    docker buildx create --name ouitransfer-builder --use 2>/dev/null || docker buildx use ouitransfer-builder
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --target server-runner \
        -t ouitransfer/server:latest \
        -t ouitransfer/server:{{tag}} \
        --push \
        .
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --target web-runner \
        -t ouitransfer/web:latest \
        -t ouitransfer/web:{{tag}} \
        --push \
        .

# Start all services (build locally + docker compose up -d)
docker-start:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml up -d --build

# Start services using published GHCR images (no local build)
# Uses dev defaults from docker-compose.yaml — override with a .env file (see .env.docker.example)
docker-start-published:
    docker compose up -d --pull always

# Stop all services (docker compose down)
docker-stop:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml down

# Tail logs for all services
docker-logs:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml logs -f

# Open a shell in the server container
docker-shell:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml exec server /bin/sh

# Remove all containers and volumes (destructive — data loss)
docker-clean:
    docker compose -f docker-compose.yaml -f docker-compose.ci.yml down -v
    docker system prune -f

# ─── Dependencies & Setup ────────────────────────────────────────────────────

# Install all dependencies
install:
    pnpm install

# First-time project setup: install deps + generate Prisma client
setup: install db-generate
    @echo "Setup complete. Copy .env.example to .env and configure your environment."

# First-time LOCAL DEV setup: install + generate Prisma client + create dev SQLite DB
setup-dev: install db-generate db-dev-init
    @echo "Dev setup complete. Run 'just dev' to start all services (API server starts without S3)."

# ─── Cleanup ─────────────────────────────────────────────────────────────────

# Remove build artifacts (.next, dist/, generated/) — keeps node_modules intact
clean:
    rm -rf apps/server/dist apps/server/src/generated apps/web/.next apps/docs/.next packages/shared/dist
    @echo "Build artifacts removed."

# Full clean: build artifacts + all node_modules (run 'just install' to restore)
clean-all: clean
    rm -rf node_modules apps/server/node_modules apps/web/node_modules apps/docs/node_modules packages/shared/node_modules packages/config/node_modules
    @echo "All artifacts and node_modules removed. Run 'just install' to restore."
