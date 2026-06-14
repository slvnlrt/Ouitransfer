/**
 * health-status.integration.test.ts
 *
 * Integration tests for the health endpoints (A8-11):
 *   - GET /health         — public liveness, 200/503, NO per-subsystem breakdown
 *   - GET /health/status  — AUTHENTICATED detailed per-subsystem breakdown
 *                           (any logged-in user — NOT admin-restricted)
 *
 * The auth guard is stubbed below: a request carrying `x-test-auth: true` is
 * treated as an authenticated session; everything else is rejected with a 401, so
 * we can exercise both the gate and the detailed payload without wiring a full
 * JWT/DB stack.
 */

import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import type { FastifyRequest } from "fastify";
import { fastify } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "../utils/app-error.js";

// Mock prisma to avoid a real DB connection.
// emailJob mocks are needed because the health routes now evaluate email health
// (queue-derived) via evaluateEmailHealth().
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
    emailJob: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

// Mock the config service so smtpEnabled resolution does not hit the DB.
// Missing key (NotFoundError) ⇒ email status "disabled".
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockRejectedValue(new Error("Configuration smtpEnabled not found")),
}));

// A8-11: stub the JWT pre-validation so /health/status can be tested as both
// an unauthenticated (rejected) and an authenticated (allowed) caller. The
// endpoint is auth-gated, NOT admin-gated, so a plain authenticated session
// (`x-test-auth: true`) is sufficient.
vi.mock("../middleware/jwt-prevalidation.js", () => ({
  createJwtPreValidation: () => async (request: FastifyRequest) => {
    if (request.headers["x-test-auth"] !== "true") {
      throw new UnauthorizedError("Unauthorized: a valid token is required.");
    }
  },
}));

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

describe("GET /health/status (authenticated detailed breakdown)", () => {
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

  it("requires authentication (rejects an unauthenticated caller)", async () => {
    const response = await app.inject({ method: "GET", url: "/health/status" });
    // The stubbed JWT guard throws UnauthorizedError → 401 via the error handler.
    expect(response.statusCode).toBe(401);
  });

  it("returns the detailed per-subsystem breakdown for any authenticated user", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
      headers: { "x-test-auth": "true" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      timestamp: string;
      uptime: number;
      checks: { database: string; storage: string; email: string };
    }>();
    expect(body.status).toBe("healthy");
    expect(body.checks.database).toBe("ok");
    // storage is "not_configured" since s3Client is null in test env
    expect(body.checks.storage).toBe("not_configured");
    // smtpEnabled config key is missing in tests ⇒ email subsystem is "disabled".
    expect(body.checks.email).toBe("disabled");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
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

  it("returns degraded when database check fails", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB connection failed"));

    const response = await app.inject({
      method: "GET",
      url: "/health/status",
      headers: { "x-test-auth": "true" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; checks: { database: string } }>();
    // DB fails, storage not configured (treated as ok) → degraded
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
  });
});

describe("GET /health/status — degraded (storage unreachable)", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    storageState.s3Enabled = true;
    storageState.sendImpl.mockRejectedValue(new Error("Connection refused"));

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    storageState.s3Enabled = false;
    storageState.sendImpl.mockResolvedValue({});
    await app.close();
  });

  it("returns degraded when storage is configured but unreachable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/status",
      headers: { "x-test-auth": "true" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; checks: { storage: string } }>();
    // DB succeeds, storage configured but throws → storage "error" → degraded
    expect(body.status).toBe("degraded");
    expect(body.checks.storage).toBe("error");
  });
});
