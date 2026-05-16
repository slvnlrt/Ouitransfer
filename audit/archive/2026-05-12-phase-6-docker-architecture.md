# Phase 6: 3-Container Docker Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolith supervisord container (MinIO + API + Web) with a clean 3-container Docker Compose architecture using RustFS, Fastify, and Next.js as separate services.

**Architecture:** Split the single container into 3 services: `storage` (RustFS official image — S3-compatible object storage), `server` (Fastify API), and `web` (Next.js frontend). Single Dockerfile with two build targets (`server-runner`, `web-runner`). RustFS uses the official `rustfs/rustfs:latest` image directly. Services start in dependency order via Docker Compose healthchecks: storage → server → web.

**Tech Stack:** Docker, Docker Compose, RustFS, Node.js 24 Alpine, Fastify 5, Next.js 15, @aws-sdk/client-s3, Prisma (SQLite)

**Covered audit items:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.14, 6.15 (eval), 6.16 (verify)

---

## Critical Context

- **Project rules:** ESM everywhere (`.js` extensions in imports), kebab-case files, Zod validation, AppError hierarchy. Always run full test suite for touched packages.
- **No production users:** Breaking changes are fine. No migration needed.
- **`ENABLE_S3` env var:** Kept for semantic meaning. `false` = internal storage (RustFS in Compose, proxy-based uploads). `true` = external S3 (presigned URLs). Only change: credentials always from env vars (file reading removed).
- **`isInternalStorage` branching:** `s3-storage/controller.ts` uses this to return proxy paths (internal) vs presigned URLs (external). This behavior is preserved unchanged.
- **Test commands:** `pnpm --filter ouitransfer-api test`, `pnpm --filter ouitransfer-web test`, `pnpm --filter ouitransfer-api run type-check`

---

### Task 1: Delete obsolete MinIO/supervisord infrastructure files

**Files:**
- Delete: `infra/install-minio.sh` (60 lines — MinIO binary download)
- Delete: `infra/start-minio.sh` (82 lines — MinIO startup script)
- Delete: `infra/minio-setup.sh` (118 lines — bucket creation via mc)
- Delete: `infra/load-minio-credentials.sh` (26 lines — credential file reader)
- Delete: `infra/install-mc.sh` (56 lines — mc client download)
- Delete: `infra/supervisord.conf` (63 lines — 4-process supervisor config)
- Delete: `infra/build-docker.sh` (39 lines — interactive Docker build, item 6.10)

- [ ] **Step 1: Delete the 7 files**

```bash
git rm infra/install-minio.sh infra/start-minio.sh infra/minio-setup.sh infra/load-minio-credentials.sh infra/install-mc.sh infra/supervisord.conf infra/build-docker.sh
```

- [ ] **Step 2: Verify no broken references**

Search the codebase for imports or references to these deleted files (excluding Dockerfile, docker-compose, and docs — those are updated in later tasks):

```bash
rg -l "install-minio|start-minio|minio-setup|load-minio|install-mc|supervisord\.conf|build-docker" --glob "!Dockerfile" --glob "!docker-compose*" --glob "!*.md" --glob "!*.mdx" --glob "!audit/*"
```

Expected: no results (or only files being updated in later tasks).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(infra): delete obsolete MinIO/supervisord files (Phase 6)"
```

---

### Task 2: Simplify storage.config.ts and add bucket auto-creation

**Files:**
- Modify: `apps/server/src/config/storage.config.ts`
- Modify: `apps/server/src/server.ts` (add ensureBucket call)
- Test: `apps/server/src/__tests__/` (new or existing storage config tests)

**Why:** Remove `loadInternalStorageCredentials()` which reads `/app/server/.minio-credentials` file. This file-based credential passing was a workaround for sharing secrets between processes in the same container. With separate containers, credentials come from env vars. Also add `ensureBucket()` to replace the 118-line `minio-setup.sh` shell script.

- [ ] **Step 1: Write the failing test for ensureBucket**

Create `apps/server/src/config/__tests__/storage-ensure-bucket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the S3 client before importing the module under test
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  HeadBucketCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "HeadBucket" })),
  CreateBucketCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: "CreateBucket" })),
  NodeHttpHandler: vi.fn(),
}));

describe("ensureBucket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not attempt anything when S3 client is null", async () => {
    // This tests the guard clause — import dynamically after mocks
    const { ensureBucket } = await import("../storage.config.js");
    // When s3Client is null (no S3 config), ensureBucket should be a no-op
    // Actual behavior depends on whether S3 env vars are set in test env
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should skip creation when bucket already exists", async () => {
    mockSend.mockResolvedValueOnce({}); // HeadBucket succeeds
    const { ensureBucket } = await import("../storage.config.js");
    await ensureBucket();
    // HeadBucket was called, CreateBucket was not
  });

  it("should create bucket when it does not exist", async () => {
    const notFoundError = new Error("NotFound");
    notFoundError.name = "NotFound";
    mockSend
      .mockRejectedValueOnce(notFoundError) // HeadBucket fails
      .mockResolvedValueOnce({}); // CreateBucket succeeds
    const { ensureBucket } = await import("../storage.config.js");
    await ensureBucket();
  });

  it("should rethrow non-NotFound errors", async () => {
    const otherError = new Error("AccessDenied");
    otherError.name = "AccessDenied";
    mockSend.mockRejectedValueOnce(otherError);
    const { ensureBucket } = await import("../storage.config.js");
    await expect(ensureBucket()).rejects.toThrow("AccessDenied");
  });
});
```

Note: The test structure above is illustrative. The implementing agent should adapt based on the actual module structure — `ensureBucket` needs access to `s3Client` and `bucketName`, so the mocking strategy may need adjustment. The key behaviors to test are: (1) no-op when S3 not configured, (2) skip when bucket exists, (3) create when missing, (4) rethrow unexpected errors.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter ouitransfer-api test -- --run src/config/__tests__/storage-ensure-bucket.test.ts
```

Expected: FAIL (ensureBucket doesn't exist yet)

- [ ] **Step 3: Rewrite storage.config.ts**

Replace the entire file `apps/server/src/config/storage.config.ts` with:

```typescript
import * as https from "node:https";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { env } from "../env.js";
import type { StorageConfig } from "../types/storage.js";

/**
 * Storage configuration — always from environment variables.
 *
 * - ENABLE_S3=false (default): Internal storage (RustFS in Docker Compose).
 *   S3_* env vars point to the internal RustFS service. STORAGE_URL required for presigned URLs.
 * - ENABLE_S3=true: External S3 (AWS, S3-compatible, etc).
 *   S3_* env vars point to the external provider. STORAGE_URL not needed.
 */
export const storageConfig: StorageConfig = {
  endpoint: env.S3_ENDPOINT || "",
  port: env.S3_PORT ? Number(env.S3_PORT) : undefined,
  useSSL: env.S3_USE_SSL === "true",
  accessKey: env.S3_ACCESS_KEY || "",
  secretKey: env.S3_SECRET_KEY || "",
  region: env.S3_REGION || "",
  bucketName: env.S3_BUCKET_NAME || "",
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
};

/**
 * Whether to reject self-signed TLS certificates for S3 connections.
 * Should only be disabled for testing with self-signed certificates.
 */
export const rejectUnauthorized = env.S3_REJECT_UNAUTHORIZED !== "false";

const hasValidConfig = storageConfig.endpoint && storageConfig.accessKey && storageConfig.secretKey;

function buildEndpointUrl(config: StorageConfig): string {
  const protocol = config.useSSL ? "https" : "http";
  const port = config.port ? `:${config.port}` : "";
  return `${protocol}://${config.endpoint}${port}`;
}

export const s3Client = hasValidConfig
  ? new S3Client({
      endpoint: buildEndpointUrl(storageConfig),
      region: storageConfig.region,
      credentials: {
        accessKeyId: storageConfig.accessKey,
        secretAccessKey: storageConfig.secretKey,
      },
      forcePathStyle: storageConfig.forcePathStyle,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ rejectUnauthorized }),
        requestTimeout: 300000,
      }),
    })
  : null;

export const bucketName = storageConfig.bucketName;

/** S3 is always the storage backend. ENABLE_S3 controls internal vs external. */
export const isS3Enabled = s3Client !== null;
export const isExternalS3 = env.ENABLE_S3 === "true";
export const isInternalStorage = s3Client !== null && env.ENABLE_S3 !== "true";

/**
 * Creates a public S3 client for presigned URL generation.
 * - Internal storage: Uses STORAGE_URL (browsers can't reach the internal Docker endpoint)
 * - External S3: Uses the original S3 endpoint (already public)
 */
export function createPublicS3Client(): S3Client | null {
  if (!s3Client) return null;

  let publicEndpoint: string;

  if (isInternalStorage) {
    if (!env.STORAGE_URL) {
      throw new Error(
        "[STORAGE] STORAGE_URL is required for internal storage (ENABLE_S3=false). " +
          "Set it to the public URL browsers use to reach storage " +
          "(e.g., https://storage.example.com or http://192.168.1.100:9000)",
      );
    }
    publicEndpoint = env.STORAGE_URL;
  } else {
    publicEndpoint = buildEndpointUrl(storageConfig);
  }

  return new S3Client({
    endpoint: publicEndpoint,
    region: storageConfig.region,
    credentials: {
      accessKeyId: storageConfig.accessKey,
      secretAccessKey: storageConfig.secretKey,
    },
    forcePathStyle: storageConfig.forcePathStyle,
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({ rejectUnauthorized }),
      requestTimeout: 300000,
    }),
  });
}

/**
 * Ensure the configured bucket exists, creating it if necessary.
 * Replaces the shell-based minio-setup.sh bucket creation.
 * Called once at server startup.
 */
export async function ensureBucket(): Promise<void> {
  if (!s3Client || !bucketName) {
    // console.log used here because this runs at startup before Pino logger is available
    // via the Fastify app instance.
    console.log("[STORAGE] S3 not configured — skipping bucket check");
    return;
  }

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`[STORAGE] Bucket "${bucketName}" exists`);
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === "NotFound" || err.name === "NoSuchBucket") {
      console.log(`[STORAGE] Creating bucket "${bucketName}"...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`[STORAGE] Bucket "${bucketName}" created`);
    } else {
      throw error;
    }
  }
}
```

Key changes from the original:
- Removed `loadInternalStorageCredentials()` (file reading) — credentials always from env vars
- Removed `fs` import (no longer needed)
- Extracted `buildEndpointUrl()` helper (DRY — used by both s3Client and publicS3Client)
- Added `ensureBucket()` (replaces `minio-setup.sh`)
- Added `HeadBucketCommand` and `CreateBucketCommand` imports

- [ ] **Step 4: Add ensureBucket call to server startup**

Edit `apps/server/src/server.ts`. After the auto-migration call (line 53), add the bucket check:

```typescript
// After line 53: await runAutoMigration();
const { ensureBucket } = await import("./config/storage.config.js");
await ensureBucket();
```

The dynamic import is already the pattern used for `isInternalStorage` on line 51.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter ouitransfer-api test
```

Expected: ALL tests pass (including the new ensureBucket test and all existing tests).

- [ ] **Step 6: Run type-check**

```bash
pnpm --filter ouitransfer-api run type-check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/config/storage.config.ts apps/server/src/server.ts apps/server/src/config/__tests__/
git commit -m "feat(server): simplify storage config and add bucket auto-creation (Phase 6)"
```

---

### Task 3: Enhance health endpoint with DB and S3 checks (item 6.11)

**Files:**
- Modify: `apps/server/src/modules/health/controller.ts`
- Modify: `apps/server/src/modules/health/routes.ts` (updated schema + status code)
- Test: existing health endpoint tests (find with `rg -l "health" apps/server/src --glob "*test*"`)

**Why:** Current health endpoint returns `{ status: "healthy" }` without checking anything. A real healthcheck should verify database connectivity and storage accessibility.

- [ ] **Step 1: Write the failing test**

Find the existing health test file (likely `apps/server/src/modules/health/__tests__/` or similar). Add tests for the new behavior:

```typescript
// Add to existing health endpoint tests:

it("should return 200 with checks when all services are healthy", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.status).toBe("healthy");
  expect(body.timestamp).toBeDefined();
  expect(body.checks).toBeDefined();
  expect(body.checks.database).toBe("ok");
  // storage check depends on test environment
});

it("should include uptime in response", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  const body = JSON.parse(res.body);
  expect(typeof body.uptime).toBe("number");
  expect(body.uptime).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter ouitransfer-api test
```

Expected: new tests FAIL (response doesn't have `checks` field yet).

- [ ] **Step 3: Update health controller**

Replace `apps/server/src/modules/health/controller.ts`:

```typescript
import { HeadBucketCommand } from "@aws-sdk/client-s3";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { prisma } from "../../shared/prisma.js";

interface HealthCheckResult {
  status: "healthy" | "degraded";
  timestamp: string;
  uptime: number;
  checks: {
    database: "ok" | "error";
    storage: "ok" | "error" | "not_configured";
  };
}

export class HealthController {
  async check(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult["checks"] = {
      database: "error",
      storage: "not_configured",
    };

    // Database check — simple query to verify connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    // Storage check — verify bucket is accessible
    if (s3Client && bucketName) {
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        checks.storage = "ok";
      } catch {
        checks.storage = "error";
      }
    }

    const allHealthy = Object.values(checks).every(
      (v) => v === "ok" || v === "not_configured",
    );

    return {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }
}
```

- [ ] **Step 4: Update health routes with response schema and status code**

Replace `apps/server/src/modules/health/routes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { HealthController } from "./controller.js";

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  uptime: z.number(),
  checks: z.object({
    database: z.enum(["ok", "error"]),
    storage: z.enum(["ok", "error", "not_configured"]),
  }),
});

export async function healthRoutes(app: FastifyInstance) {
  const healthController = new HealthController();

  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        operationId: "checkHealth",
        summary: "Check API Health",
        description:
          "Returns the health status of the API including database and storage checks. " +
          "Returns 200 when healthy, 503 when degraded.",
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await healthController.check();
      const statusCode = result.status === "healthy" ? 200 : 503;
      return reply.code(statusCode).send(result);
    },
  );
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter ouitransfer-api test
```

Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/health/
git commit -m "feat(server): enhance health endpoint with DB and S3 checks (6.11)"
```

---

### Task 4: Rewrite server-start.sh

**Files:**
- Modify: `infra/server-start.sh`

**Why:** Remove MinIO credential waiting/loading (60 lines). Keep DB setup, config copying, and privilege drop. Consistent UID/GID default (1001, matching Dockerfile).

- [ ] **Step 1: Replace server-start.sh**

Replace `infra/server-start.sh` entirely:

```bash
#!/bin/sh
set -e

echo "Starting Ouitransfer server..."

TARGET_UID=${OUITRANSFER_UID:-1001}
TARGET_GID=${OUITRANSFER_GID:-1001}

cd /app/ouitransfer-app

export DATABASE_URL="file:/app/server/prisma/ouitransfer.db"

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
    run_as_user npx prisma db push --schema=./prisma/schema.prisma --skip-generate
    run_as_user node ./prisma/seed.js
    echo "Database setup complete."
else
    echo "Existing database found. Checking for schema updates..."
    run_as_user npx prisma db push --schema=./prisma/schema.prisma --skip-generate

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
```

Key changes:
- Removed MinIO credential waiting loop (lines 7-27 of old file)
- Removed credential file loading (lines 30-32 of old file)
- Consistent UID/GID default: 1001 (was 1000, now matches Dockerfile)
- Removed emojis from log messages (cleaner in container logs)
- Simplified ownership fixing (no minio-data directory)

- [ ] **Step 2: Commit**

```bash
git add infra/server-start.sh
git commit -m "refactor(infra): simplify server-start.sh — remove MinIO credential handling"
```

---

### Task 5: Rewrite Dockerfile with multi-target build

**Files:**
- Modify: `Dockerfile`

**Why:** Replace the monolith (supervisord, MinIO, heredoc start.sh) with two clean build targets: `server-runner` and `web-runner`. Each produces a minimal single-process image. Addresses items 6.1, 6.2, 6.3, 6.4, 6.15.

- [ ] **Step 1: (Optional) Evaluate pnpm deploy**

Before writing the Dockerfile, test if `pnpm deploy` produces a self-contained server directory:

```bash
cd apps/server
pnpm deploy --prod /tmp/server-deploy
ls /tmp/server-deploy/node_modules/@ouitransfer
```

If `@ouitransfer/shared` is resolved correctly in the deploy output, use `pnpm deploy` in the Dockerfile (simpler COPY commands, no symlink workarounds). If not, fall back to the existing symlink pattern.

Note: This step may only work on Linux. If evaluating on Windows/macOS, skip and use the fallback approach.

- [ ] **Step 2: Replace Dockerfile**

Replace the entire `Dockerfile` with:

```dockerfile
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
RUN pnpm install --frozen-lockfile --filter ouitransfer-api


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
RUN pnpm install --frozen-lockfile --filter ouitransfer-web


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
```

Key changes from the original Dockerfile:
- **No MinIO/mc installation** — storage is a separate container
- **No supervisord** — each target runs a single process
- **No heredoc start.sh** — the inline 100-line script is gone
- **No VOLUME declaration** — volumes declared in docker-compose only (item 6.3)
- **Two build targets** — `server-runner` and `web-runner` (item 6.2)
- **Consistent UID/GID** — 1001 everywhere (item 6.4)
- **Lowercase user** — `ouitransfer` not `OUITRANSFER` (fixes case sensitivity)
- **Proper healthchecks** — server checks /health API, web checks port 5487
- **Web runs as non-root** — `USER nextjs` (no privilege drop needed)

If `pnpm deploy` evaluation (Step 1) succeeded, replace the server-runner COPY section:
```dockerfile
# With pnpm deploy (simpler, no symlink workaround):
COPY --from=server-deploy --chown=ouitransfer:nodejs /deploy/server ./
```
And add a deploy stage after server-builder.

- [ ] **Step 3: Verify Docker build**

```bash
docker build --target server-runner -t ouitransfer-server:test .
docker build --target web-runner -t ouitransfer-web:test .
```

Both must build successfully.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat(docker): rewrite Dockerfile with multi-target build (server + web)"
```

---

### Task 6: Rewrite docker-compose.yaml with 3 services

**Files:**
- Modify: `docker-compose.yaml`

- [ ] **Step 1: Replace docker-compose.yaml**

```yaml
# ==============================================================================
# Ouitransfer — Docker Compose (3-container architecture)
#
# Services:
#   storage  — RustFS (S3-compatible object storage)
#   server   — Fastify API
#   web      — Next.js frontend
#
# Quick start:
#   1. Set the required values below (marked REQUIRED)
#   2. Run: docker compose up -d
#   3. Open http://localhost:5487
#
# Startup order: storage → server → web (via healthcheck dependencies)
# ==============================================================================

services:
  # ─── S3-Compatible Object Storage ──────────────────────────────────────────
  storage:
    image: rustfs/rustfs:latest
    container_name: ouitransfer-storage
    command: rustfs server /data
    environment:
      RUSTFS_ACCESS_KEY: ouitransfer
      RUSTFS_SECRET_KEY: ouitransfer-secret-key    # CHANGE in production
      RUSTFS_CONSOLE_ENABLE: "true"
    volumes:
      - storage_data:/data
    ports:
      - "9000:9000"    # S3 API — must be reachable by browsers for file uploads
      # - "9001:9001"  # Storage console (optional, for debugging)
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9000/minio/health/live || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  # ─── Fastify API Server ────────────────────────────────────────────────────
  server:
    image: ouitransfer/server:latest
    # Uncomment to build locally instead of pulling:
    # build:
    #   context: .
    #   target: server-runner
    container_name: ouitransfer-server
    environment:
      # ── Storage connection (must match storage service credentials) ──
      S3_ENDPOINT: storage
      S3_PORT: "9000"
      S3_USE_SSL: "false"
      S3_ACCESS_KEY: ouitransfer
      S3_SECRET_KEY: ouitransfer-secret-key         # Must match RUSTFS_SECRET_KEY
      S3_BUCKET_NAME: ouitransfer-files
      S3_REGION: auto
      S3_FORCE_PATH_STYLE: "true"

      # REQUIRED: Public URL where browsers can reach the storage service.
      # Include protocol. The port must match the storage service's published port.
      # Examples:
      #   http://localhost:9000           (local development)
      #   http://192.168.1.100:9000      (LAN access)
      #   https://storage.example.com    (production with reverse proxy)
      STORAGE_URL: "http://localhost:9000"

      # REQUIRED: Security secrets — generate each with: openssl rand -hex 32
      # All three MUST be different from each other.
      JWT_SECRET: "change-me-jwt-secret-at-least-32-characters-long!!"
      CSRF_SECRET: "change-me-csrf-secret-at-least-32-characters-long!"
      COOKIE_SECRET: "change-me-cookie-at-least-32-characters-long!!!"
      #
      # ── Optional settings ──
      # OUITRANSFER_UID: "1000"              # UID for server process
      # OUITRANSFER_GID: "1000"              # GID for server process
      # SECURE_SITE: "true"                  # Set true when behind HTTPS reverse proxy
      # PRESIGNED_URL_EXPIRATION: "3600"     # Upload URL expiration (seconds)
      # PRESIGNED_GET_URL_EXPIRATION: "900"  # Download URL expiration (seconds)
      #
      # ── External S3 (instead of bundled storage) ──
      # To use AWS S3, Backblaze B2, etc. instead of the storage service:
      # 1. Remove or stop the 'storage' service
      # 2. Set ENABLE_S3=true
      # 3. Update S3_* vars with your provider's credentials
      # 4. Remove STORAGE_URL (not needed for external S3)
      # ENABLE_S3: "true"
    volumes:
      - server_data:/app/server
    ports:
      - "3333:3333"    # API (optional: only needed for direct API access)
    depends_on:
      storage:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3333/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

  # ─── Next.js Web Frontend ──────────────────────────────────────────────────
  web:
    image: ouitransfer/web:latest
    # Uncomment to build locally instead of pulling:
    # build:
    #   context: .
    #   target: web-runner
    container_name: ouitransfer-web
    environment:
      API_BASE_URL: "http://server:3333"
      # DEFAULT_LANGUAGE: "en-US"
    ports:
      - "5487:5487"    # Web interface
    depends_on:
      server:
        condition: service_healthy
    restart: unless-stopped

volumes:
  storage_data:
  server_data:
```

Key design decisions:
- **Hardcoded credentials with CHANGE warnings** — simpler than env_file for self-hosters
- **`depends_on` with `service_healthy`** — proper startup ordering
- **Storage port 9000** — RustFS default (was 9379 for MinIO). Simpler, standard
- **No VOLUME in Dockerfile** — only in compose (item 6.3)
- **External S3 documented inline** — as commented env vars
- **`command: rustfs server /data`** — explicit entry point

- [ ] **Step 2: Verify compose config is valid**

```bash
docker compose config
```

Expected: YAML is valid, services are correctly defined.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yaml
git commit -m "feat(docker): rewrite docker-compose with 3 services (RustFS + server + web)"
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace .env.example**

```bash
# Ouitransfer — Environment Variables
# Copy to .env and adjust values for your environment.
#
# For Docker Compose deployment, see docker-compose.yaml instead.
# This file is for local development (running apps directly on the host).

# ============================================================================
# Server (Backend) — Fastify API
# ============================================================================

# Database connection string (SQLite by default)
DATABASE_URL="file:./ouitransfer.db"

# ============================================================================
# S3 Storage Configuration
# ============================================================================
# The server always uses S3-compatible storage. For local development,
# run RustFS: docker run -p 9000:9000 -e RUSTFS_ACCESS_KEY=dev -e RUSTFS_SECRET_KEY=devsecret rustfs/rustfs:latest rustfs server /data

# S3 endpoint hostname (e.g., localhost, storage.example.com, s3.amazonaws.com)
S3_ENDPOINT=localhost

# S3 port (typically 9000 for RustFS/MinIO, 443 for AWS)
S3_PORT=9000

# Use SSL/TLS for S3 connection
S3_USE_SSL=false

# S3 credentials
S3_ACCESS_KEY=dev
S3_SECRET_KEY=devsecret

# S3 region
S3_REGION=auto

# S3 bucket name
S3_BUCKET_NAME=ouitransfer-files

# Force path-style URLs (required for RustFS, MinIO, and most self-hosted S3)
S3_FORCE_PATH_STYLE=true

# Reject unauthorized SSL certificates (set to false for self-signed certs)
# S3_REJECT_UNAUTHORIZED=true

# Public URL where browsers reach the storage (required when using internal storage)
# For local dev: http://localhost:9000
# For production: https://storage.yourdomain.com
STORAGE_URL=http://localhost:9000

# External S3 mode (set to true for AWS S3, Backblaze B2, etc.)
# When true, STORAGE_URL is not needed — presigned URLs use S3_ENDPOINT directly.
# ENABLE_S3=true

# Presigned URL expiration (seconds)
# PRESIGNED_URL_EXPIRATION=3600
# PRESIGNED_GET_URL_EXPIRATION=900

# ============================================================================
# Security (REQUIRED — generate each with: openssl rand -hex 32)
# ============================================================================

JWT_SECRET=
CSRF_SECRET=
COOKIE_SECRET=

# Set to true when behind an HTTPS reverse proxy
# SECURE_SITE=true

# Trust proxy setting (loopback, specific IPs, or true for all)
# TRUST_PROXY=loopback

# ============================================================================
# Web Frontend (Next.js)
# ============================================================================

# Backend API URL (must match server port)
API_BASE_URL=http://localhost:3333

# Default language (e.g., en-US, fr-FR, de-DE)
NEXT_PUBLIC_DEFAULT_LANGUAGE=en-US

# Upload chunk size in megabytes
NEXT_PUBLIC_UPLOAD_CHUNK_SIZE_MB=50
```

Key changes:
- Removed `ENABLE_S3=false` default (confusing — S3 is always used)
- Removed legacy encryption vars (ENCRYPTION_KEY, DISABLE_FILESYSTEM_ENCRYPTION)
- Replaced MinIO references with RustFS
- Added RustFS local dev docker run command
- Added security secrets section with generation instructions
- Clearer comments

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example for RustFS and 3-container architecture"
```

---

### Task 8: Remove SMTP placeholder credentials from seed (item 6.14)

**Files:**
- Modify: `apps/server/prisma/seed.js`

- [ ] **Step 1: Update SMTP seed values**

In `apps/server/prisma/seed.js`, find the SMTP configuration entries (around lines 86-119) and replace placeholder values with empty strings:

```javascript
// Change these entries:
{ key: "smtpHost", value: "", type: "string", group: "email" },
{ key: "smtpPort", value: "587", type: "number", group: "email" },  // Port is a sane default, keep it
{ key: "smtpUser", value: "", type: "string", group: "email" },
{ key: "smtpPass", value: "", type: "string", group: "email" },
{ key: "smtpFromName", value: "Ouitransfer", type: "string", group: "email" },
{ key: "smtpFromEmail", value: "", type: "string", group: "email" },
```

Specifically:
- `smtpHost`: `"smtp.gmail.com"` → `""`
- `smtpUser`: `"your-email@gmail.com"` → `""`
- `smtpPass`: `"your-app-specific-password"` → `""`
- `smtpFromName`: `"OUITRANSFER"` → `"Ouitransfer"` (proper casing)
- `smtpFromEmail`: check current value and set to `""`

- [ ] **Step 2: Commit**

```bash
git add apps/server/prisma/seed.js
git commit -m "fix(seed): remove SMTP placeholder credentials (6.14)"
```

---

### Task 9: Verify lefthook Windows fix (item 6.16)

**Files:**
- Check: `lefthook.yml`

- [ ] **Step 1: Verify current state**

Read `lefthook.yml`. The current config already uses `--staged` (Biome's native flag) instead of `{staged_files}` (lefthook's expansion):

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      run: pnpm exec biome check --write --unsafe --no-errors-on-unmatched --files-ignore-unknown=true --staged
      stage_fixed: true
```

The `--staged` flag is handled internally by Biome — it reads the git index directly, bypassing the Windows command-line length limit. This means item 6.16 is **already fixed**.

- [ ] **Step 2: Mark as done (no code change needed)**

No commit needed. Update audit tracking in Task 13.

---

### Task 10: Update Justfile docker recipes

**Files:**
- Modify: `Justfile`

- [ ] **Step 1: Update docker-build recipe**

The current recipe builds a single image. Update it to build two images with different targets:

```just
# Build and push Docker images (both server and web)
docker-build tag="latest":
    docker buildx build --platform linux/amd64,linux/arm64 \
        --target server-runner \
        -t burger-cie/ouitransfer-server:{{tag}} --push .
    docker buildx build --platform linux/amd64,linux/arm64 \
        --target web-runner \
        -t burger-cie/ouitransfer-web:{{tag}} --push .
```

Also update `docker-shell` to specify which container:

```just
# Open shell in server container
docker-shell service="server":
    docker compose exec ouitransfer-{{service}} /bin/sh
```

- [ ] **Step 2: Update container names in other docker recipes**

Update `docker-logs`, `docker-clean`, etc. if they reference the old `ouitransfer` container name.

- [ ] **Step 3: Commit**

```bash
git add Justfile
git commit -m "chore(just): update docker recipes for 3-container architecture"
```

---

### Task 11: Update code comments — replace Garage/MinIO references

**Files to modify (8 TypeScript files + 1 workflow):**

| File | Lines | Change |
|------|-------|--------|
| `apps/server/src/env.ts` | 16 | `"S3/Garage"` → `"S3"` |
| `apps/server/src/modules/s3-storage/controller.ts` | 4,8,9,30 | `"Garage"` → `"S3-compatible storage"` |
| `apps/server/src/modules/file/service.ts` | 9 | `"Garage internal or external S3"` → `"S3-compatible storage"` |
| `apps/server/src/modules/folder/service.ts` | 10 | Same as above |
| `apps/server/src/modules/file/embed.controller.ts` | 87 | `"S3/MinIO"` → `"S3"` |
| `apps/server/src/modules/file/download.controller.ts` | 185 | `"S3/MinIO"` → `"S3"` |
| `apps/server/src/scripts/migrate-filesystem-to-s3.ts` | 2 | `"Garage"` → `"S3"` |
| `apps/server/src/scripts/cleanup-orphan-files.ts` | 11 | `"Garage or External"` → `"S3-compatible storage"` |
| `.github/workflows/e2e.yml` | 6 | `"MinIO"` → `"RustFS"` |

- [ ] **Step 1: Update all comment references**

For each file, replace the Garage/MinIO references with generic S3-compatible or RustFS references. These are all comments or log strings — no logic changes.

- [ ] **Step 2: Verify no regressions**

```bash
pnpm --filter ouitransfer-api run type-check
pnpm --filter ouitransfer-api test
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src .github/workflows/e2e.yml
git commit -m "docs(code): replace Garage/MinIO references with S3-compatible/RustFS"
```

---

### Task 12: Update user-facing documentation

**Files:**
- Modify: `apps/docs/content/docs/v3-beta/manual-installation.mdx` (~10 MinIO refs)
- Modify: `apps/docs/content/docs/v3-beta/s3-providers.mdx` (~12 MinIO refs, full MinIO section)
- Modify: `apps/docs/content/docs/v3-beta/quick-start.mdx` (3 refs)
- Modify: `apps/docs/content/docs/v3-beta/architecture.mdx` (2 refs)
- Modify: `apps/docs/content/docs/v3-beta/uid-gid-configuration.mdx` (port 9379 refs)
- Modify: `infra/SCRIPTS.md` (rewrite — currently references Makefile)

**General approach:**
- Replace "MinIO" with "RustFS" where referring to the bundled storage
- Keep "MinIO" where referring to MinIO as an external S3 provider option
- Update docker run commands and port numbers (9379 → 9000, 9378 → 9001)
- Update credential names and defaults
- In `s3-providers.mdx`, rename the "MinIO (Self-hosted)" section to "RustFS / MinIO (Self-hosted)" and add RustFS docker command

- [ ] **Step 1: Update each documentation file**

For `manual-installation.mdx`:
- Replace MinIO docker run command with RustFS equivalent
- Update default credentials from `minioadmin` to `ouitransfer`/`ouitransfer-secret-key`
- Update port references

For `s3-providers.mdx`:
- Add RustFS as the primary self-hosted option
- Keep MinIO as an alternative
- Update example configurations

For `quick-start.mdx`:
- Update docker-compose example (now 3 services)
- Update environment variable examples

For `architecture.mdx`:
- Update architecture description to mention RustFS
- Update the single-container description to 3-container

For `uid-gid-configuration.mdx`:
- Update port references (9379 → 9000)

For `infra/SCRIPTS.md`:
- Rewrite to reference `just` commands (currently references `Makefile`/`make`)
- Document the new docker-compose workflow
- Remove MinIO-specific scripts documentation

- [ ] **Step 2: Verify docs build**

```bash
pnpm --filter ouitransfer-docs build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/content infra/SCRIPTS.md
git commit -m "docs: update documentation for RustFS and 3-container architecture"
```

---

### Task 13: Update CLAUDE.md and audit tracking

**Files:**
- Modify: `CLAUDE.md`
- Modify: `audit/CONSOLIDATED-TODO-LIST.md`
- Modify: `audit/DONE.md`

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`:
1. Line 6: `"S3-compatible storage (MinIO or external)"` → `"S3-compatible storage (RustFS or external)"`
2. Line 21: `"Docker, MinIO, deployment scripts"` → `"Docker, RustFS, deployment scripts"`
3. Add Phase 6 completion status section following the pattern of Phases 0-5
4. Update the Architecture section to reflect 3-container setup

Add Phase 6 status block:

```markdown
### Phase 6 — Infrastructure & Operations: COMPLETE
Monolith container (supervisord with MinIO + API + Web) replaced with 3-container Docker Compose
architecture. RustFS (Apache 2.0 MinIO replacement) as separate storage service, Fastify server
and Next.js web as independent containers. Eliminated 7 shell scripts, supervisord, 100-line
Dockerfile heredoc, credential file dance. storage.config.ts simplified (env vars only, no file
reading). Bucket auto-creation in TypeScript replaces minio-setup.sh. Health endpoint enhanced
with DB + S3 connectivity checks. server-start.sh simplified (no MinIO credential handling).
SMTP placeholder credentials removed from seed. Garage/MinIO code comments updated.
Documentation updated for RustFS.
```

- [ ] **Step 2: Update CONSOLIDATED-TODO-LIST.md**

Mark items 6.1-6.12, 6.14 as `[x]` (done). Mark 6.15 as `[x]` with note "(evaluated)" or `[x]` if pnpm deploy was adopted. Mark 6.16 as `[x]` with note "(already fixed — uses Biome --staged)".

- [ ] **Step 3: Update DONE.md**

Add Phase 6 completed items to the DONE.md log, following the existing format.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md audit/CONSOLIDATED-TODO-LIST.md audit/DONE.md
git commit -m "docs(audit): mark Phase 6 items complete, update project status"
```

---

## Verification Checklist (run after all tasks)

Before claiming Phase 6 complete:

```bash
# TypeScript compilation
pnpm --filter ouitransfer-api run type-check
pnpm --filter ouitransfer-web run type-check

# Full test suites
pnpm --filter ouitransfer-api test
pnpm --filter ouitransfer-web test
pnpm --filter @ouitransfer/shared test

# Docker build (both targets)
docker build --target server-runner -t ouitransfer-server:test .
docker build --target web-runner -t ouitransfer-web:test .

# Docker Compose validation
docker compose config

# (Optional) Full stack smoke test
docker compose up -d
# Wait for all services to be healthy
docker compose ps
# Verify health endpoint
curl http://localhost:3333/health
# Verify web
curl -I http://localhost:5487
docker compose down
```

## Parallelization Guide

For subagent-driven execution, these task groups can run in parallel:

| Group | Tasks | Rationale |
|-------|-------|-----------|
| A | 1, 8, 9 | Independent: file deletions, seed fix, lefthook verification |
| B | 2, 3 | Server code: storage config + health endpoint (different files) |
| C | 4, 5, 6, 7 | Infrastructure: depends on knowing final code shape from Group B |
| D | 10, 11, 12, 13 | Updates: Justfile, comments, docs, audit (all independent) |

Execute: A → B → C → D (groups in sequence, tasks within each group in parallel).
