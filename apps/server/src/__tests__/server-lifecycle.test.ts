/**
 * server-lifecycle.test.ts
 *
 * Integration test for the full server lifecycle: buildApp() → register plugins
 * and routes → app.listen() → app.close(). This exercises Fastify 5's
 * "no mutations after listen" rule, which app.inject()-based tests never trigger
 * (inject() calls ready() implicitly, but never calls listen()).
 *
 * Strategy: replicate server.ts startup inline — same plugins, same routes,
 * same onClose hooks — but use port 0 to avoid conflicts and dummy intervals to
 * avoid running real cron-style cleanup during tests.
 */

import type { AddressInfo } from "node:net";
import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Static mocks (must be declared before any dynamic imports) ─────────────

// Mock Prisma to avoid a real DB connection
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
    loginAttempt: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    folder: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    file: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    share: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reverseShare: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    invite: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    appConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    },
    passwordReset: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

// Mock storage config
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

// Mock directories config (for ensureDirectories in server.ts)
vi.mock("../config/directories.config.js", () => ({
  directoriesConfig: {
    uploads: "/tmp/test-uploads",
    tempUploads: "/tmp/test-temp-uploads",
  },
}));

// Mock node:fs/promises to avoid real filesystem operations
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock config service (used by several route modules at registration time)
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  setConfigValue: vi.fn().mockResolvedValue(undefined),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
  getGroupConfigs: vi.fn().mockResolvedValue({}),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a fully-configured Fastify app with all 14 route modules, exactly as
 * server.ts does, but without process signal handlers or real cleanup intervals.
 */
async function buildFullApp(): Promise<FastifyInstance> {
  const { buildApp } = await import("../app.js");
  const app: FastifyInstance = await buildApp();

  // Register multipart BEFORE routes (same as server.ts line 56)
  await app.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024 * 1024,
      fields: 10,
      fileSize: 50 * 1024 * 1024,
      files: 1,
      headerPairs: 2000,
    },
  });

  // Register all 14 route modules (same order as server.ts lines 67-80)
  const { authRoutes } = await import("../modules/auth/routes.js");
  const { authProvidersRoutes } = await import("../modules/auth-providers/routes.js");
  const { twoFactorRoutes } = await import("../modules/two-factor/routes.js");
  const { inviteRoutes } = await import("../modules/invite/routes.js");
  const { userRoutes } = await import("../modules/user/routes.js");
  const { folderRoutes } = await import("../modules/folder/routes.js");
  const { fileRoutes } = await import("../modules/file/routes.js");
  const { shareRoutes } = await import("../modules/share/routes.js");
  const { reverseShareRoutes } = await import("../modules/reverse-share/routes.js");
  const { storageRoutes } = await import("../modules/storage/routes.js");
  const { appRoutes } = await import("../modules/app/routes.js");
  const { auditRoutes } = await import("../modules/audit/routes.js");
  const { healthRoutes } = await import("../modules/health/routes.js");
  const { s3StorageRoutes } = await import("../modules/s3-storage/routes.js");

  app.register(authRoutes);
  app.register(authProvidersRoutes, { prefix: "/auth" });
  app.register(twoFactorRoutes, { prefix: "/auth" });
  app.register(inviteRoutes);
  app.register(userRoutes);
  app.register(folderRoutes);
  app.register(fileRoutes);
  app.register(shareRoutes);
  app.register(reverseShareRoutes);
  app.register(storageRoutes);
  app.register(appRoutes);
  app.register(auditRoutes);
  app.register(healthRoutes);
  app.register(s3StorageRoutes);

  return app;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("Server lifecycle integration", () => {
  beforeEach(() => {
    // Fresh module cache so each test gets a clean env.ts parse
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
  });

  it("Test 1: full listen/close lifecycle completes without error", {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
    vi.stubEnv("NODE_ENV", "test");

    const app = await buildFullApp();

    // Register dummy onClose hooks (mirrors server.ts lines 121-122)
    const dummyInterval1 = setInterval(() => {}, 1_000_000);
    const dummyInterval2 = setInterval(() => {}, 1_000_000);
    app.addHook("onClose", () => clearInterval(dummyInterval1));
    app.addHook("onClose", () => clearInterval(dummyInterval2));

    try {
      // listen on port 0 → OS assigns a random available port
      await app.listen({ port: 0, host: "127.0.0.1" });

      const addr = app.server.address() as AddressInfo;
      expect(addr).not.toBeNull();
      expect(addr.port).toBeGreaterThan(0);
      expect(addr.address).toBe("127.0.0.1");
    } finally {
      await app.close();
    }
  });

  it("Test 2: health endpoint responds with 200 after listen", { timeout: 30_000 }, async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
    vi.stubEnv("NODE_ENV", "test");

    const app = await buildFullApp();

    try {
      await app.listen({ port: 0, host: "127.0.0.1" });

      // app.inject() still works after listen — it bypasses the network layer
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ status: string }>();
      expect(body.status).toBe("healthy");
    } finally {
      await app.close();
    }
  });

  it("Test 3: onClose hooks fire on shutdown", { timeout: 30_000 }, async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
    vi.stubEnv("NODE_ENV", "test");

    const app = await buildFullApp();

    // Track whether hooks were called
    let hook1Called = false;
    let hook2Called = false;

    const interval1 = setInterval(() => {}, 1_000_000);
    const interval2 = setInterval(() => {}, 1_000_000);

    // Register onClose hooks BEFORE listen (Fastify 5 rejects hooks after listen)
    app.addHook("onClose", () => {
      clearInterval(interval1);
      hook1Called = true;
    });
    app.addHook("onClose", () => {
      clearInterval(interval2);
      hook2Called = true;
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    await app.close();

    expect(hook1Called).toBe(true);
    expect(hook2Called).toBe(true);
  });
});
