#!/bin/sh
set -e

echo "Starting Ouitransfer server..."

TARGET_UID=${OUITRANSFER_UID:-1001}
TARGET_GID=${OUITRANSFER_GID:-1001}

cd /app/ouitransfer-app

export DATABASE_URL="file:/app/server/prisma/ouitransfer.db"

# Prisma CLI path — uses node directly (no npx/.bin dependency)
PRISMA_CLI="node_modules/prisma/build/index.js"
# tsx is needed to run seed.js (Prisma 7 generates TypeScript-only client)
# Use direct path (not .bin symlink — pnpm deploy may not create it)
TSX="node node_modules/tsx/dist/cli.mjs"

echo "Data directory: /app/server"
echo "Database: $DATABASE_URL"

# Create data directories
mkdir -p /app/server/prisma /app/server/uploads /app/server/temp-uploads

# Fix ownership when running as root
if [ "$(id -u)" = "0" ]; then
    echo "Setting ownership (UID:$TARGET_UID, GID:$TARGET_GID)..."

    # Base directories (fast, non-recursive)
    chown "$TARGET_UID:$TARGET_GID" /app/server /app/server/uploads /app/server/temp-uploads 2>/dev/null || true
    chmod 755 /app/server /app/server/uploads /app/server/temp-uploads 2>/dev/null || true

    # Database directory (recursive — contains DB files)
    chown -R "$TARGET_UID:$TARGET_GID" /app/server/prisma 2>/dev/null || true
    chmod -R 755 /app/server/prisma 2>/dev/null || true

    # Application files (shallow — dist is read-only)
    find /app/ouitransfer-app -maxdepth 2 -exec chown "$TARGET_UID:$TARGET_GID" {} + 2>/dev/null || true
    chown -R "$TARGET_UID:$TARGET_GID" /home/ouitransfer 2>/dev/null || true
fi

# Helper: run command as target user
run_as_user() {
    if [ "$(id -u)" = "0" ]; then
        su-exec "$TARGET_UID:$TARGET_GID" "$@"
    else
        "$@"
    fi
}

# Database setup — apply migrations (creates the DB on first run, applies pending migrations otherwise)
DB_FILE="/app/server/prisma/ouitransfer.db"

# Safety net: before applying pending migrations to an EXISTING database, take a
# WAL-safe backup. migrate status exits non-zero when migrations are pending.
if [ -f "$DB_FILE" ]; then
    if run_as_user node "$PRISMA_CLI" migrate status --schema=./prisma/schema.prisma >/dev/null 2>&1; then
        echo "Database schema is up to date."
    else
        echo "Pending migrations detected — backing up database first..."
        run_as_user $TSX ./src/scripts/db-backup.ts
    fi
fi

echo "Applying database migrations..."
run_as_user node "$PRISMA_CLI" migrate deploy --schema=./prisma/schema.prisma

# Seed the database. Seeding is idempotent ("protected mode": it only inserts
# MISSING config/provider rows), so it runs UNCONDITIONALLY on every boot — this
# backfills newly-added config keys and self-heals a partially-seeded DB. There is
# deliberately no completeness gate: a fragile gate previously skipped seeding,
# leaving the server without its configuration. A failure here is fatal (set -e)
# rather than silently booting an unconfigured server.
echo "Seeding database..."
run_as_user $TSX ./prisma/seed.js
echo "Database setup complete."

# Start server
echo "Starting Fastify server..."
if [ "$(id -u)" = "0" ]; then
    exec su-exec "$TARGET_UID:$TARGET_GID" node dist/server.js
else
    exec node dist/server.js
fi
