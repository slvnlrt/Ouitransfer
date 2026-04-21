# Justfile for Ouitransfer
# Usage: just <recipe>
# Install just: https://just.systems/man/en/

# Default recipe — print help
default: help

# ─── Help ────────────────────────────────────────────────────────────────────

@help:
    echo ""
    echo "OUITRANSFER - Available Commands"
    echo ""
    echo "  Docker / Production"
    echo "    just build                - Build Docker image (multi-platform)"
    echo "    just update-version <v>   - Update version in all package.json files"
    echo "    just start                - Start containers (docker compose up -d)"
    echo "    just stop                 - Stop containers (docker compose down)"
    echo "    just logs                 - Tail container logs"
    echo "    just clean                - Remove containers, volumes, prune images"
    echo "    just shell                - Open shell in OUITRANSFER container"
    echo ""
    echo "  Development"
    echo "    just dev                  - Run all apps in dev mode (turbo)"
    echo "    just dev-server           - Run API server only"
    echo "    just dev-web              - Run web frontend only"
    echo "    just dev-docs             - Run docs site only"
    echo ""
    echo "  Quality"
    echo "    just lint                 - Run linter across all packages"
    echo "    just format               - Run formatter across all packages"
    echo "    just type-check           - Run TypeScript type-check"
    echo "    just validate             - Run full validation pipeline"
    echo "    just test                 - Run test suite"
    echo ""
    echo "  Dependencies"
    echo "    just install              - Install all dependencies (pnpm install)"
    echo ""

# ─── Docker / Production ─────────────────────────────────────────────────────

# Build Docker image using the build script
build:
    @echo "Building OUITRANSFER Docker image..."
    @echo "This will update version numbers in all package.json files before building."
    chmod +x ./infra/update-versions.sh
    chmod +x ./infra/build-docker.sh
    @echo "Starting build process..."
    ./infra/build-docker.sh

# Update version in all package.json files — usage: just update-version 3.4.0
update-version version:
    @echo "Updating version to {{version}}..."
    chmod +x ./infra/update-versions.sh
    ./infra/update-versions.sh "{{version}}"

# Start the application
start:
    @echo "Starting OUITRANSFER..."
    docker compose up -d

# Stop the application
stop:
    @echo "Stopping OUITRANSFER..."
    docker compose down

# Tail container logs
logs:
    docker compose logs -f

# Remove containers, volumes, and prune images
clean:
    @echo "Cleaning up Docker containers, volumes, and images..."
    docker compose down -v
    docker system prune -f
    @echo "Cleanup complete."

# Open a shell in the running OUITRANSFER container
shell:
    docker compose exec OUITRANSFER /bin/sh

# ─── Development ─────────────────────────────────────────────────────────────

# Run all apps in dev mode via Turborepo
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

# Lint all packages
lint:
    pnpm lint

# Format all packages
format:
    pnpm format

# TypeScript type-check across all packages
type-check:
    pnpm type-check

# Run full validation pipeline (lint + type-check + build)
validate:
    pnpm validate

# Run test suite
test:
    pnpm test

# ─── Dependencies ────────────────────────────────────────────────────────────

# Install all dependencies
install:
    pnpm install
