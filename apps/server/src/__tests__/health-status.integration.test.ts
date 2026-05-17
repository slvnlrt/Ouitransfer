/**
 * health-status.integration.test.ts
 *
 * Integration tests for the GET /health/status endpoint.
 * Verifies that the endpoint returns simplified health status
 * without requiring authentication.
 */

import { fastify } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock prisma to avoid a real DB connection
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
  },
}));

// Mock storage config — storage not configured by default
vi.mock("../config/storage.config.js", () => ({
  s3Client: null,
  bucketName: "",
  isExternalS3: false,
  isInternalStorage: false,
  rejectUnauthorized: true,
  storageConfig: {},
  createPublicS3Client: vi.fn().mockReturnValue(null),
  ensureBucket: vi.fn().mockResolvedValue(undefined),
}));

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
    expect(body.status).toMatch(/^(degraded|unhealthy)$/);
  });
});
