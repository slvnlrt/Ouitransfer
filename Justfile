# Justfile for Ouitransfer
# Usage: just <recipe>  |  just --list
# Install just: https://just.systems/man/en/

# Default recipe — list available commands
default:
    @just --list

# ─── Development ─────────────────────────────────────────────────────────────

# Run all apps in dev mode (turbo)
dev:
    pnpm dev

# Run API server only
dev-server:
    pnpm dev:server

# Run web frontend only
dev-web:
    pnpm dev:web

# Run docs site only
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
    pnpm --filter=ouitransfer-api run db:migrate:dev

# Open Prisma Studio (visual database browser)
db-studio:
    pnpm --filter=ouitransfer-api exec prisma studio

# Seed the database with initial data
db-seed:
    pnpm --filter=ouitransfer-api run db:seed

# Reset database: drop all data and re-run migrations — DEV ONLY
db-reset:
    pnpm --filter=ouitransfer-api exec prisma migrate reset

# ─── Docker / Production ─────────────────────────────────────────────────────

# Build multi-platform Docker image and push — usage: just docker-build [tag]
# Requires: docker buildx, authenticated to registry (burger-cie/ouitransfer)
docker-build tag="latest":
    @echo "Building ouitransfer Docker image (tag: {{tag}})..."
    docker buildx create --name ouitransfer-builder --use 2>/dev/null || docker buildx use ouitransfer-builder
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t burger-cie/ouitransfer:latest \
        -t burger-cie/ouitransfer:{{tag}} \
        --push \
        .

# Start the application (docker compose up -d)
docker-start:
    docker compose up -d

# Stop the application (docker compose down)
docker-stop:
    docker compose down

# Tail container logs
docker-logs:
    docker compose logs -f

# Open a shell in the running container
docker-shell:
    docker compose exec ouitransfer /bin/sh

# Remove containers and volumes (destructive — data loss)
docker-clean:
    docker compose down -v
    docker system prune -f

# ─── Dependencies & Setup ────────────────────────────────────────────────────

# Install all dependencies
install:
    pnpm install

# First-time project setup: install deps + generate Prisma client
setup: install db-generate
    @echo "Setup complete. Copy .env.example to .env and configure your environment."

# ─── Versioning (Changesets) ─────────────────────────────────────────────────

# Create a new changeset describing your changes
changeset:
    pnpm changeset

# Apply pending changesets: bump versions in all package.json files
version-bump:
    pnpm version-packages

# Create git tags for the current version (run after version-bump + commit)
release:
    pnpm release

# ─── Cleanup ─────────────────────────────────────────────────────────────────

# Remove build artifacts (.next, dist/) — keeps node_modules intact
clean:
    rm -rf apps/server/dist apps/web/.next apps/docs/.next packages/shared/dist
    @echo "Build artifacts removed."

# Full clean: build artifacts + all node_modules (run 'just install' to restore)
clean-all: clean
    rm -rf node_modules apps/server/node_modules apps/web/node_modules apps/docs/node_modules packages/shared/node_modules packages/config/node_modules
    @echo "All artifacts and node_modules removed. Run 'just install' to restore."
