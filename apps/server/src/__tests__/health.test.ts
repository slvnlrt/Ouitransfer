import { fastify } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock prisma to avoid a real DB connection in unit tests
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
  },
}));

// Mock storage.config so s3Client is null (storage not configured in test env)
vi.mock("../config/storage.config.js", () => ({
  s3Client: null,
  bucketName: "",
  isS3Enabled: false,
  isExternalS3: false,
  isInternalStorage: false,
  rejectUnauthorized: true,
  storageConfig: {},
  createPublicS3Client: vi.fn().mockReturnValue(null),
  ensureBucket: vi.fn().mockResolvedValue(undefined),
}));

import { healthRoutes } from "../modules/health/routes.js";

describe("Health endpoint", () => {
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

  it("GET /health returns 200 with healthy status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      status: string;
      timestamp: string;
      uptime: number;
      checks: { database: string; storage: string };
    }>();
    expect(body.status).toBe("healthy");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
    expect(body.checks.database).toBe("ok");
    // storage is "not_configured" since s3Client is null in test env
    expect(body.checks.storage).toBe("not_configured");
  });

  it("GET /health response schema includes all expected fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("checks");
    expect(body.checks).toHaveProperty("database");
    expect(body.checks).toHaveProperty("storage");
  });
});

describe("Health endpoint — degraded state", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    // Override prisma mock to simulate DB failure
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("DB connection failed"));

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("GET /health returns 503 when database check fails", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(503);

    const body = response.json<{
      status: string;
      checks: { database: string; storage: string };
    }>();
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
  });
});
