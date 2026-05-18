/**
 * quota.integration.test.ts
 *
 * Integration tests for quota enforcement using app.inject().
 *
 * Tests the full request lifecycle for:
 * - POST /files (registerFile) — quota enforcement (size, total storage, admin unlimited)
 * - GET /storage/disk-space — returns warningLevel/percentage/maxFileSize for regular users
 * - GET/PATCH /users/:id/quota — admin endpoints for reading and setting quotas
 *
 * Per Rule 10 (Fastify+Zod strips unknown fields) we keep route-level and controller schemas in sync.
 * Per Rule 11 (service-layer tests are not sufficient) these tests exercise the full pipeline.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      }),
      update: vi.fn().mockResolvedValue({
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      }),
    },
    file: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { size: BigInt(0) },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "file-new",
        name: "photo.jpg",
        description: null,
        extension: "jpg",
        size: BigInt(1024),
        objectName: "user-1/valid-object",
        userId: "user-1",
        folderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    folder: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    reverseShareFile: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      }),
    },
  },
}));

// ── Mock config service ───────────────────────────────────────────────────────
// maxTotalStoragePerUser = 1 GB so 800 MB = 78%, 1 GB = 100%, etc.
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "maxFileSize") return String(100 * 1024 * 1024); // 100 MB
    if (key === "maxTotalStoragePerUser") return String(1024 * 1024 * 1024); // 1 GB
    if (key === "passwordMinLength") return "8";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock validateTokenVersion — always trusts tokens in this test suite ───────
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock FileService (avoid S3 dependency) ────────────────────────────────────
// getObjectHead returns a small buffer file-type cannot identify (plain text),
// so magic-byte check passes for tests focused on quota, not MIME validation.
vi.mock("../modules/file/service.js", () => ({
  FileService: class MockFileService {
    getPresignedPutUrl = vi.fn().mockResolvedValue("https://s3.example.com/presigned");
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    deleteObject = vi.fn().mockResolvedValue(undefined);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("Quota enforcement integration tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { fileRoutes } = await import("../modules/file/routes.js");
    const { storageRoutes } = await import("../modules/storage/routes.js");
    const { quotaRoutes } = await import("../modules/quota/routes.js");
    app.register(fileRoutes);
    app.register(storageRoutes);
    app.register(quotaRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signTestToken(userId: string, isAdmin = false): string {
    const jwt = app.jwt.sign({ userId, isAdmin, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string | undefined }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    return { csrfToken, csrfCookie: csrfCookie?.value };
  }

  async function postFile(
    userId: string,
    filePayload: {
      name?: string;
      extension?: string;
      mimeType?: string;
      size: number;
      objectName?: string;
    },
  ): Promise<ReturnType<typeof app.inject>> {
    const token = signTestToken(userId);
    const { csrfToken, csrfCookie } = await getCsrf();

    const payload = {
      name: filePayload.name ?? "photo.jpg",
      extension: filePayload.extension ?? "jpg",
      mimeType: filePayload.mimeType ?? "image/jpeg",
      size: filePayload.size,
      objectName: filePayload.objectName ?? `${userId}/valid-object`,
    };

    return app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });
  }

  // ── describe: POST /files — quota enforcement ────────────────────────────────

  describe("POST /files (registerFile) — quota enforcement", () => {
    it("blocks upload when over total storage quota", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "user-quota-exceeded";

      // User: non-admin, no overrides → uses global 1 GB limit
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: already at 1 GB (= full quota)
      const oneGB = BigInt(1024 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: oneGB },
        _count: 1,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      const res = await postFile(userId, {
        size: 1024, // any non-zero size
        objectName: `${userId}/valid-object`,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.code).toBe("INSUFFICIENT_STORAGE");
    });

    it("allows upload when under quota", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "user-under-quota";

      // User: non-admin, no overrides → uses global 1 GB limit
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: 500 MB used (well under 1 GB)
      const fivehundredMB = BigInt(500 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: fivehundredMB },
        _count: 1,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      // file.create will be called on success
      vi.mocked(prisma.file.create).mockResolvedValue({
        id: "file-new",
        name: "photo.jpg",
        description: null,
        extension: "jpg",
        size: BigInt(1024),
        objectName: `${userId}/valid-object`,
        userId,
        folderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await postFile(userId, {
        size: 1024,
        objectName: `${userId}/valid-object`,
      });

      expect(res.statusCode).toBe(201);
    });

    it("allows upload when user has unlimited override (0)", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "user-unlimited-override";

      // User: non-admin with 0n override = unlimited
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: BigInt(0), // explicit unlimited
      } as never);

      // Storage: 100 GB used (doesn't matter, limit is 0 = unlimited)
      const hundredGB = BigInt(100 * 1024 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: hundredGB },
        _count: 100,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      vi.mocked(prisma.file.create).mockResolvedValue({
        id: "file-new",
        name: "photo.jpg",
        description: null,
        extension: "jpg",
        size: BigInt(1024),
        objectName: `${userId}/valid-object`,
        userId,
        folderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await postFile(userId, {
        size: 1024,
        objectName: `${userId}/valid-object`,
      });

      expect(res.statusCode).toBe(201);
    });

    it("admin has unlimited by default", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "admin-user";

      // Admin with no overrides → unlimited by default
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: true,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: 100 GB used (irrelevant for admin)
      const hundredGB = BigInt(100 * 1024 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: hundredGB },
        _count: 100,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      // Admin token
      const token = signTestToken(userId, true);
      const { csrfToken, csrfCookie } = await getCsrf();

      vi.mocked(prisma.file.create).mockResolvedValue({
        id: "file-new",
        name: "photo.jpg",
        description: null,
        extension: "jpg",
        size: BigInt(1024),
        objectName: `${userId}/valid-object`,
        userId,
        folderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await app.inject({
        method: "POST",
        url: "/files",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          name: "photo.jpg",
          extension: "jpg",
          mimeType: "image/jpeg",
          size: 1024,
          objectName: `${userId}/valid-object`,
        }),
      });

      expect(res.statusCode).toBe(201);
    });

    it("blocks file exceeding per-file max size", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "user-file-too-large";

      // User: non-admin, no overrides → maxFileSize = 100 MB from config
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: empty
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: BigInt(0) },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      // 200 MB file size — exceeds 100 MB limit
      const twoHundredMB = 200 * 1024 * 1024;

      const res = await postFile(userId, {
        size: twoHundredMB,
        objectName: `${userId}/valid-object`,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.code).toBe("FILE_SIZE_EXCEEDED");
    });
  });

  // ── describe: GET /storage/disk-space — user quota info ──────────────────────

  describe("GET /storage/disk-space — user quota info", () => {
    it("returns quota info with warningLevel for regular user", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const userId = "user-disk-space";

      // User: non-admin, no overrides → 1 GB quota
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: 860 MB used = ~84% of 1 GB → warningLevel = "warning" (threshold is 80%)
      const eightSixtyMB = BigInt(860 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: eightSixtyMB },
        _count: 1,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      const token = signTestToken(userId);
      const res = await app.inject({
        method: "GET",
        url: "/storage/disk-space",
        headers: {
          cookie: `token=${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.warningLevel).toBeDefined();
      expect(body.warningLevel).toBe("warning");
      expect(body.percentage).toBeDefined();
      // BigInt division: (860 * 100) / 1024 = 83 (integer truncation before Math.round)
      expect(body.percentage).toBe(83);
      expect(body.maxFileSize).toBeDefined();
      expect(body.maxFileSize).toBe(100 * 1024 * 1024); // 100 MB
      expect(body.uploadAllowed).toBe(true);
    });
  });

  // ── describe: GET/PATCH /users/:id/quota — admin endpoints ──────────────────

  describe("GET/PATCH /users/:id/quota — admin endpoints", () => {
    it("GET returns quota status for a user", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const adminId = "admin-user-quota";
      const targetUserId = "user-to-query";

      vi.mocked(prisma.user.count).mockResolvedValue(1);
      // Controller calls findUnique for target user (for overrides)
      // QuotaService.resolveEffectiveLimits also calls findUnique for same user
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // Storage: 500 MB used
      const fivehundredMB = BigInt(500 * 1024 * 1024);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: fivehundredMB },
        _count: 5,
        _avg: {},
        _min: {},
        _max: {},
      } as never);
      vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      const adminToken = signTestToken(adminId, true);

      const res = await app.inject({
        method: "GET",
        url: `/users/${targetUserId}/quota`,
        headers: {
          cookie: `token=${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.used).toBeDefined();
      expect(body.maxTotalStorage).toBeDefined();
      expect(body.warningLevel).toBeDefined();
      expect(body.uploadAllowed).toBeDefined();
      expect(body.overrides).toBeDefined();
      expect(body.overrides.maxFileSizeOverride).toBeNull();
      expect(body.overrides.maxTotalStorageOverride).toBeNull();
    });

    it("PATCH sets per-user quota overrides", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const adminId = "admin-user-patch";
      const targetUserId = "user-to-patch";

      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
      } as never);

      // After update: overrides are set
      const newStorageOverride = BigInt(2 * 1024 * 1024 * 1024); // 2 GB
      const newFileSizeOverride = BigInt(200 * 1024 * 1024); // 200 MB
      vi.mocked(prisma.user.update).mockResolvedValue({
        maxFileSizeOverride: newFileSizeOverride,
        maxTotalStorageOverride: newStorageOverride,
      } as never);

      const adminToken = signTestToken(adminId, true);
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PATCH",
        url: `/users/${targetUserId}/quota`,
        headers: {
          "content-type": "application/json",
          cookie: `token=${adminToken}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          maxFileSizeOverride: String(newFileSizeOverride),
          maxTotalStorageOverride: String(newStorageOverride),
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.message).toBe("User quota overrides updated");
      expect(body.overrides).toBeDefined();
      expect(body.overrides.maxFileSizeOverride).toBe(String(newFileSizeOverride));
      expect(body.overrides.maxTotalStorageOverride).toBe(String(newStorageOverride));

      // Verify prisma.user.update was called
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it("rejects non-admin access to quota endpoints", async () => {
      const { prisma } = await import("../shared/prisma.js");
      const regularUserId = "regular-user";

      vi.mocked(prisma.user.count).mockResolvedValue(1);

      const regularToken = signTestToken(regularUserId, false);

      const res = await app.inject({
        method: "GET",
        url: `/users/${regularUserId}/quota`,
        headers: {
          cookie: `token=${regularToken}`,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });
});
