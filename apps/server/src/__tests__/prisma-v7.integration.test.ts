/**
 * prisma-v7.integration.test.ts
 *
 * Integration tests verifying that Prisma v7 works correctly after migration
 * from v6. Covers three concerns:
 *
 * 1. Smoke test — the Prisma adapter pattern (better-sqlite3) initialises and
 *    can execute a raw query.
 * 2. P2002 (unique constraint) → 409 UNIQUE_CONSTRAINT via the full Fastify
 *    request lifecycle (app.inject() → route → globalErrorHandler).
 * 3. P2025 (record not found) → 404 RECORD_NOT_FOUND via the full lifecycle.
 *
 * These tests exercise REAL Prisma v7 errors (not structurally-faked objects)
 * so they validate that `isPrismaKnownRequestError` in error-handler.ts can
 * still detect errors produced by the v7 client's runtime.
 *
 * NOTE: Unlike most integration tests, this file does NOT mock prisma.
 * It uses the real `ouitransfer.db` dev database with cleanup.
 * It points to the real DB via DATABASE_URL so the existing schema is available.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { type FastifyInstance, fastify } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_URL } from "../shared/prisma-constants.js";
import { createPrismaClient } from "../shared/prisma-factory.js";
import { globalErrorHandler } from "../utils/error-handler.js";

// ── File-level setup: ensure the database schema exists ─────────────────────
// This is the only test file that uses the real database (not mocked).
// In CI, no `prisma migrate deploy` runs before tests, so we push the schema
// here to guarantee the tables exist.
const SERVER_DIR = resolve(import.meta.dirname!, "..", "..");

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  execSync("npx prisma db push --accept-data-loss", {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
});

// ── Unique sentinel name used for P2002 test isolation ───────────────────────
// A UUID-style name that is extremely unlikely to already exist in the dev DB.
const TEST_GROUP_NAME = "prisma-v7-test-group-__unique__";
const NONEXISTENT_ID = "prisma-v7-nonexistent-cuid-xxxxxxx";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Fastify instance that only registers:
 * - Zod type provider (validator + serializer)
 * - globalErrorHandler
 *
 * Test routes are added inline. No JWT, CSRF, cookies — keeps the bootstrap
 * fast and avoids env-var requirements for secrets.
 */
function buildMinimalApp(): FastifyInstance {
  const app = fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(globalErrorHandler);
  return app;
}

// ── 1. Smoke test — Prisma adapter pattern ───────────────────────────────────

describe("Prisma v7 smoke test", () => {
  it("prisma client is importable and connected (adapter pattern works)", async () => {
    // Use the factory so we don't import the shared singleton that other test
    // files may have mocked. The factory creates a fresh client each time.
    const client = createPrismaClient();
    try {
      const result = await client.$queryRawUnsafe<{ ok: number | bigint }[]>("SELECT 1 as ok");
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      // better-sqlite3 returns SQLite integers as BigInt — compare loosely
      expect(Number(result[0].ok)).toBe(1);
    } finally {
      await client.$disconnect();
    }
  });
});

// ── 2. P2002 → 409 (unique constraint violation) ─────────────────────────────

describe("Prisma v7 — P2002 unique constraint → 409 via app.inject()", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildMinimalApp();

    // Register a test-only route that triggers a real P2002 by trying to
    // create two groups with the same unique name.
    app.post("/test/prisma-p2002", async (_request, _reply) => {
      const client = createPrismaClient();
      try {
        // First insert — should succeed (or already exists from a previous run)
        try {
          await client.group.create({
            data: { name: TEST_GROUP_NAME },
          });
        } catch {
          // If it already exists from a previous aborted run, ignore this error
          // and proceed to the second insert which WILL throw P2002.
        }

        // Second insert — guaranteed to violate the unique constraint → P2002
        await client.group.create({
          data: { name: TEST_GROUP_NAME },
        });

        // Should not reach here
        return { created: true };
      } finally {
        // Always clean up: delete the test group regardless of outcome
        await client.group.deleteMany({ where: { name: TEST_GROUP_NAME } });
        await client.$disconnect();
      }
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 409 with code=UNIQUE_CONSTRAINT when Prisma throws P2002", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/prisma-p2002",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("UNIQUE_CONSTRAINT");
    expect(body.error).toBe("Conflict");
    expect(body.statusCode).toBe(409);
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

// ── 3. P2025 → 404 (record not found) ────────────────────────────────────────

describe("Prisma v7 — P2025 record not found → 404 via app.inject()", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildMinimalApp();

    // Register a test-only route that triggers a real P2025 by deleting a
    // record that does not exist (Prisma throws P2025 for deleteOrThrow on
    // missing records, or update with a non-existent where clause).
    app.post("/test/prisma-p2025", async (_request, _reply) => {
      const client = createPrismaClient();
      try {
        // Prisma's deleteOrThrow throws P2025 when the record does not exist.
        // The `delete` method (not deleteOrThrow) also throws P2025 in SQLite
        // via better-sqlite3 adapter when the WHERE clause matches no rows.
        await client.group.delete({
          where: { id: NONEXISTENT_ID },
        });

        // Should not reach here
        return { deleted: true };
      } finally {
        await client.$disconnect();
      }
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 404 with code=RECORD_NOT_FOUND when Prisma throws P2025", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/prisma-p2025",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("RECORD_NOT_FOUND");
    expect(body.error).toBe("Not Found");
    expect(body.statusCode).toBe(404);
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
