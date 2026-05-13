#!/bin/sh
set -e

echo "Starting Ouitransfer server..."

TARGET_UID=${OUITRANSFER_UID:-1001}
TARGET_GID=${OUITRANSFER_GID:-1001}

cd /app/ouitransfer-app

export DATABASE_URL="file:/app/server/prisma/ouitransfer.db"

# Prisma CLI path — uses node directly (no npx/.bin dependency)
PRISMA_CLI="node_modules/prisma/build/index.js"

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

# Copy config files on first run
if [ ! -f "/app/server/prisma/configs.json" ]; then
    echo "First run: copying configuration files..."
    cp -f /app/infra/configs.json /app/server/prisma/configs.json 2>/dev/null || true
    cp -f /app/infra/providers.json /app/server/prisma/providers.json 2>/dev/null || true
    cp -f /app/infra/check-missing.js /app/server/prisma/check-missing.js 2>/dev/null || true

    if [ "$(id -u)" = "0" ]; then
        chown "$TARGET_UID:$TARGET_GID" /app/server/prisma/configs.json /app/server/prisma/providers.json /app/server/prisma/check-missing.js 2>/dev/null || true
    fi
fi

# Database setup
if [ ! -f "/app/server/prisma/ouitransfer.db" ]; then
    echo "First run: creating database..."
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma --skip-generate
    run_as_user node ./prisma/seed.js
    echo "Database setup complete."
else
    echo "Existing database found. Checking for schema updates..."
    run_as_user node $PRISMA_CLI db push --schema=./prisma/schema.prisma --skip-generate

    NEEDS_SEEDING=$(run_as_user node ./prisma/check-missing.js check-seeding 2>/dev/null || echo "true")
    if [ "$NEEDS_SEEDING" = "true" ]; then
        echo "New data needed, running seed..."
        run_as_user node ./prisma/seed.js
    fi
fi

# Start server
echo "Starting Fastify server..."
if [ "$(id -u)" = "0" ]; then
    exec su-exec "$TARGET_UID:$TARGET_GID" node dist/server.js
else
    exec node dist/server.js
fi
