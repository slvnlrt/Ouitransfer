FROM node:24-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
  gcompat \
  supervisor \
  curl \
  wget \
  openssl \
  su-exec

# Enable pnpm and pin version
RUN corepack enable && corepack prepare pnpm@10.6.0 --activate

# Install storage system for S3-compatible storage
COPY infra/install-minio.sh /tmp/install-minio.sh
RUN chmod +x /tmp/install-minio.sh && /tmp/install-minio.sh

# Install storage client (mc) for appropriate architecture
COPY infra/install-mc.sh /tmp/install-mc.sh
RUN chmod +x /tmp/install-mc.sh && /tmp/install-mc.sh

# Set working directory
WORKDIR /app

# === SERVER BUILD STAGE ===
FROM base AS server-deps
WORKDIR /app

# Copy workspace config and root lockfile
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./

# Copy server package.json (pnpm needs workspace member manifests for filtering)
COPY apps/server/package.json apps/server/

# Install only server dependencies using workspace filtering
RUN pnpm install --frozen-lockfile --filter ouitransfer-api

FROM base AS server-builder
WORKDIR /app

# Copy installed dependencies from deps stage
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules

# Copy server source code
COPY apps/server/ ./apps/server/

WORKDIR /app/apps/server

# Generate Prisma client
RUN npx prisma generate

# Build server
RUN pnpm build

# === WEB BUILD STAGE ===
FROM base AS web-deps
WORKDIR /app

# Copy workspace config and root lockfile
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./

# Copy web package.json
COPY apps/web/package.json apps/web/

# Install only web dependencies
RUN pnpm install --frozen-lockfile --filter ouitransfer-web

FROM base AS web-builder
WORKDIR /app

# Copy installed dependencies from deps stage
COPY --from=web-deps /app/node_modules ./node_modules
COPY --from=web-deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy web source code
COPY apps/web/ ./apps/web/

WORKDIR /app/apps/web

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build web application
RUN pnpm run build

# === PRODUCTION STAGE ===
FROM base AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_BASE_URL=http://127.0.0.1:3333

# Define build arguments for user/group configuration (defaults to current values)
ARG OUITRANSFER_UID=1001
ARG OUITRANSFER_GID=1001

# Create application user with configurable UID/GID
RUN addgroup --system --gid ${OUITRANSFER_GID} nodejs
RUN adduser --system --uid ${OUITRANSFER_UID} --ingroup nodejs OUITRANSFER

# Create application directories 
RUN mkdir -p /app/ouitransfer-app /app/web /app/infra /home/ouitransfer/.npm /home/ouitransfer/.cache
RUN chown -R OUITRANSFER:nodejs /app /home/ouitransfer

# === Copy Server Files to /app/ouitransfer-app (separate from /app/server for bind mounts) ===
WORKDIR /app/ouitransfer-app

# Copy server production files
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/dist ./dist
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/node_modules ./node_modules
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/prisma ./prisma
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/package.json ./

# Copy password reset script and make it executable
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/reset-password.sh ./
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/src/scripts/ ./src/scripts/
RUN chmod +x ./reset-password.sh

# Copy seed file to the shared location for bind mounts
RUN mkdir -p /app/server/prisma
COPY --from=server-builder --chown=OUITRANSFER:nodejs /app/apps/server/prisma/seed.js /app/server/prisma/seed.js

# === Copy Web Files ===
WORKDIR /app/web

# Copy web production files
COPY --from=web-builder --chown=OUITRANSFER:nodejs /app/apps/web/public ./public
COPY --from=web-builder --chown=OUITRANSFER:nodejs /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=OUITRANSFER:nodejs /app/apps/web/.next/static ./.next/static

# === Setup Supervisor ===
WORKDIR /app

# Create supervisor configuration
RUN mkdir -p /etc/supervisor/conf.d

# Copy server start script and configuration files
COPY infra/server-start.sh /app/server-start.sh
COPY infra/start-minio.sh /app/start-minio.sh
COPY infra/minio-setup.sh /app/minio-setup.sh
COPY infra/load-minio-credentials.sh /app/load-minio-credentials.sh
COPY infra/configs.json /app/infra/configs.json
COPY infra/providers.json /app/infra/providers.json
COPY infra/check-missing.js /app/infra/check-missing.js
RUN chmod +x /app/server-start.sh /app/start-minio.sh /app/minio-setup.sh /app/load-minio-credentials.sh
RUN chown -R OUITRANSFER:nodejs /app/server-start.sh /app/start-minio.sh /app/minio-setup.sh /app/load-minio-credentials.sh /app/infra

# Copy supervisor configuration
COPY infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create main startup script
COPY <<EOF /app/start.sh
#!/bin/sh
set -e

echo "Starting OUITRANSFER Application..."
echo "Storage Mode: \${ENABLE_S3:-false}"
echo "Secure Site: \${SECURE_SITE:-false}"
echo "Encryption: \${DISABLE_FILESYSTEM_ENCRYPTION:-true}"
echo "Database: SQLite"

# Set global environment variables
export DATABASE_URL="file:/app/server/prisma/ouitransfer.db"
export NEXT_PUBLIC_DEFAULT_LANGUAGE=\${DEFAULT_LANGUAGE:-en-US}

# Ensure /app/server directory exists for bind mounts
mkdir -p /app/server/uploads /app/server/temp-uploads /app/server/prisma /app/server/minio-data

# CRITICAL: Fix permissions BEFORE starting any services
# This runs on EVERY startup to handle updates and corrupted metadata
echo "🔐 Fixing permissions for internal storage..."

# USE ENVIRONMENT VARIABLES: Allow runtime UID/GID configuration
# Falls back to OUITRANSFER user's UID/GID if not specified
TARGET_UID=\${OUITRANSFER_UID:-\$(id -u OUITRANSFER 2>/dev/null || echo "1001")}
TARGET_GID=\${OUITRANSFER_GID:-\$(id -g OUITRANSFER 2>/dev/null || echo "1001")}
echo "   Target user: OUITRANSFER (UID:\$TARGET_UID, GID:\$TARGET_GID)"

# ALWAYS remove storage system metadata to prevent corruption issues
# This is safe - storage system recreates it automatically
# User data (files) are NOT in .minio.sys, they're safe
if [ -d "/app/server/minio-data/.minio.sys" ]; then
    echo "   🧹 Cleaning storage system metadata (safe, auto-regenerated)..."
    rm -rf /app/server/minio-data/.minio.sys 2>/dev/null || true
fi

# SMART CHOWN: Only run expensive recursive chown when UID/GID changed
# This dramatically speeds up subsequent starts
UIDGID_MARKER="/app/server/.OUITRANSFER-uidgid"
CURRENT_OWNER="\$TARGET_UID:\$TARGET_GID"
NEEDS_CHOWN=false

if [ -f "\$UIDGID_MARKER" ]; then
    STORED_OWNER=\$(cat "\$UIDGID_MARKER" 2>/dev/null || echo "")
    if [ "\$STORED_OWNER" != "\$CURRENT_OWNER" ]; then
        echo "   📝 UID/GID changed (\$STORED_OWNER → \$CURRENT_OWNER)"
        NEEDS_CHOWN=true
    else
        echo "   ✓ UID/GID unchanged (\$CURRENT_OWNER), skipping chown"
    fi
else
    echo "   📝 First run or marker missing, will set ownership"
    NEEDS_CHOWN=true
fi

if [ "\$NEEDS_CHOWN" = "true" ]; then
    echo "   🔧 Setting ownership (this may take a moment on first run)..."
    
    # Only chown the directories that need it
    chown \$TARGET_UID:\$TARGET_GID /app/server 2>/dev/null || true
    
    # For most directories, just chown the directory itself (fast)
    for dir in uploads temp-uploads; do
        if [ -d "/app/server/\$dir" ]; then
            chown \$TARGET_UID:\$TARGET_GID "/app/server/\$dir" 2>/dev/null || true
        fi
    done
    
    # For prisma directory, we need recursive chown for database files
    if [ -d "/app/server/prisma" ]; then
        echo "   🔧 Fixing database permissions..."
        chown -R \$TARGET_UID:\$TARGET_GID "/app/server/prisma" 2>/dev/null || true
    fi
    
    # For minio-data, we NEED recursive chown because MinIO creates subdirectories
    # and needs write access to all of them
    if [ -d "/app/server/minio-data" ]; then
        echo "   🔧 Fixing MinIO storage permissions..."
        chown -R \$TARGET_UID:\$TARGET_GID "/app/server/minio-data" 2>/dev/null || true
    fi
    
    # Save current UID/GID to marker
    echo "\$CURRENT_OWNER" > "\$UIDGID_MARKER"
    chown \$TARGET_UID:\$TARGET_GID "\$UIDGID_MARKER" 2>/dev/null || true
    
    echo "   ✅ Ownership updated and cached"
fi

chmod 755 /app/server 2>/dev/null || echo "   ⚠️  chmod skipped"

# Verify critical directories are writable
if touch /app/server/.test-write 2>/dev/null; then
    rm -f /app/server/.test-write
    echo "   ✅ Storage directory is writable"
else
    echo "   ❌ FATAL: /app/server is NOT writable!"
    echo "   Check Docker volume permissions"
    ls -la /app/server 2>/dev/null || true
fi

echo "✅ Storage ready, starting services..."

# Start supervisor
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
EOF

RUN chmod +x /app/start.sh

# Create volume mount points for bind mounts
VOLUME ["/app/server"]

# Expose ports
EXPOSE 3333 5487 9379 9378

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:5487 || exit 1

# Start application
CMD ["/app/start.sh"]