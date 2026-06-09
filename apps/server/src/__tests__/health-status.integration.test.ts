/**
 * health-status.integration.test.ts
 *
 * Integration tests for the GET /health/status endpoint.
 * Verifies that the endpoint returns simplified health status
 * without requiring authentication.
 */

import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { fastify } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock prisma to avoid a real DB connection
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
  },
}));

/**
 * Mutable storage stub — starts as null (storage not configured).
 * The "storage unreachable" describe block enables it by setting s3Enabled = true
 * and making send() throw.
 *
 * We use explicit getters so that Vitest's ESM live-binding layer always reads
 * the current value on each import access.
 */
const storageState = {
  s3Enabled: false,
  sendImpl: vi.fn().mockResolvedValue({}),
};

// Mock storage config — storage not configured by default
vi.mock("../config/storage.config.js", () => {
  const stub = {
    get s3Client() {
      if (!storageState.s3Enabled) return null;
      return { send: storageState.sendImpl };
    },
    get bucketName() {
      return storageState.s3Enabled ? "test-bucket" : "";
    },
    isExternalS3: false,
    isInternalStorage: false,
    rejectUnauthorized: true,
    storageConfig: {},
    createPublicS3Client: vi.fn().mockReturnValue(null),
    ensureBucket: vi.fn().mockResolvedValue(undefined),
  };
  return stub;
});

// Mock logger utility — avoid "Logger not initialized" error in tests
vi.mock("../utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
  setLogger: vi.fn(),
}));

import { healthRoutes } from "../modules/health/routes.js";

describe("GET /health/status", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns simplified health status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    expect(body.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("does not require authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    // No auth headers needed — should return 200
    expect(response.statusCode).toBe(200);
  });

  it("returns only a single status field (no extra fields)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body)).toHaveLength(1);
    expect(body).toHaveProperty("status");
    expect(body).not.toHaveProperty("timestamp");
    expect(body).not.toHaveProperty("uptime");
    expect(body).not.toHaveProperty("checks");
  });

  it("returns healthy when DB succeeds and storage is not configured", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    // DB is mocked to succeed; storage not configured counts as ok
    expect(body.status).toBe("healthy");
  });
});

describe("GET /health/status — degraded (DB failure)", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns unhealthy when database check fails", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB connection failed"));

    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    // DB fails, storage not configured → only storage "ok" (not configured treated as ok),
    // DB fails → degraded
    expect(body.status).toBe("degraded");
  });
});

describe("GET /health/status — degraded (storage unreachable)", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    // Enable storage so the controller reaches the HeadBucketCommand branch,
    // but make send() throw to simulate an unreachable storage endpoint
    storageState.s3Enabled = true;
    storageState.sendImpl.mockRejectedValue(new Error("Connection refused"));

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    // Restore storage to "not configured" state for isolation
    storageState.s3Enabled = false;
    storageState.sendImpl.mockResolvedValue({});
    await app.close();
  });

  it("returns degraded when storage is configured but unreachable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string }>();
    // DB succeeds, storage configured but throws → storage "error" → degraded
    expect(body.status).toBe("degraded");
  });
});
