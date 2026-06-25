import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { fastify } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock prisma to avoid a real DB connection in unit tests.
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

/**
 * Mutable s3Client stub — starts as null (storage not configured).
 * The "both unhealthy" describe block enables it by setting s3Enabled = true
 * and making send() throw.
 *
 * We use explicit getters on the mock namespace object so that Vitest's ESM
 * live-binding layer always reads the current value on each import access.
 */
const storageState = {
  s3Enabled: false,
  sendImpl: vi.fn().mockResolvedValue({}),
};

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

import { healthRoutes } from "../modules/health/routes.js";

// ── Healthy state ──────────────────────────────────────────────────────────────

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

  it("GET /health returns 200 with healthy status (public liveness — no subsystem detail)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      status: string;
      timestamp: string;
      uptime: number;
    }>();
    expect(body.status).toBe("healthy");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /health exposes ONLY the coarse liveness fields (A8-11 — no per-subsystem breakdown)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    // Public liveness must NOT leak which backend is degraded.
    expect(Object.keys(body).sort()).toEqual(["status", "timestamp", "uptime"]);
    expect(body).not.toHaveProperty("checks");
    expect(body).not.toHaveProperty("email");
  });

  it("GET /health uptime is a non-negative number", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ uptime: number }>();
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /health timestamp is an ISO 8601 date string", async () => {
    const before = Date.now();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    const after = Date.now();

    expect(response.statusCode).toBe(200);
    const body = response.json<{ timestamp: string }>();
    const ts = Date.parse(body.timestamp);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    // ISO 8601 format: starts with full date and time components
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("GET /nonexistent returns 404 (no catch-all swallows unknown routes)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/nonexistent-route-that-does-not-exist",
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── Degraded state — DB failure ────────────────────────────────────────────────

describe("Health endpoint — degraded state", () => {
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

  it("GET /health returns 503 when the database check fails (liveness fails on DB down)", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB connection failed"));

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    // DB is the hard liveness dependency → 503 so orchestrators restart the pod.
    expect(response.statusCode).toBe(503);

    const body = response.json<{ status: string }>();
    expect(body.status).toBe("degraded");
    // No subsystem breakdown is exposed on the public liveness endpoint.
    expect(body).not.toHaveProperty("checks");
  });
});

// ── Degraded state — both DB and storage failure ───────────────────────────────

describe("Health endpoint — both DB and storage degraded", () => {
  const app = fastify({ logger: false });

  beforeAll(async () => {
    // Enable storage so the controller reaches the HeadBucketCommand branch
    storageState.s3Enabled = true;

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    // Restore storage to "not configured" state for isolation
    storageState.s3Enabled = false;
    await app.close();
  });

  it("GET /health returns 503 with degraded status when both DB and storage are down", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB connection failed"));
    storageState.sendImpl.mockRejectedValueOnce(new Error("S3 connection failed"));

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    // DB down → 503; the public endpoint never enumerates which subsystems failed.
    expect(response.statusCode).toBe(503);

    const body = response.json<{ status: string }>();
    expect(body.status).toBe("degraded");
    expect(body).not.toHaveProperty("checks");
  });
});
