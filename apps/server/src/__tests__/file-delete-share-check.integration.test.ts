/**
 * file-delete-share-check.integration.test.ts
 *
 * Integration tests for the file deletion share-check feature (B-21).
 *
 * Tests that DELETE /files/:id returns 409 when the file belongs to active
 * shares and force is not set, and proceeds when force=true.
 *
 * Per Rule 11 (service-layer tests are not sufficient) these tests exercise
 * the full Fastify request lifecycle via app.inject().
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
    },
    file: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      aggregate: vi.fn().mockResolvedValue({
        _sum: { size: BigInt(0) },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
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
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "maxFileSize") return String(100 * 1024 * 1024);
    if (key === "maxTotalStoragePerUser") return String(10 * 1024 * 1024 * 1024);
    if (key === "passwordMinLength") return "8";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock validateTokenVersion ─────────────────────────────────────────────────
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock FileService (avoid S3 dependency) ────────────────────────────────────
vi.mock("../modules/file/service.js", () => ({
  FileService: class MockFileService {
    getPresignedPutUrl = vi.fn().mockResolvedValue("https://s3.example.com/presigned");
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    deleteObject = vi.fn().mockResolvedValue(undefined);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /files/:id — share-check feature (B-21)", () => {
  let app: FastifyInstance;

  const OWNER_ID = "user-owner-1";
  const OTHER_USER_ID = "user-other-1";

  const makeFile = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "file-1",
    name: "photo.jpg",
    description: null,
    extension: "jpg",
    size: BigInt(1024),
    objectName: `${OWNER_ID}/photo.jpg`,
    userId: OWNER_ID,
    folderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    shares: [],
    ...overrides,
  });

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { fileRoutes } = await import("../modules/file/routes.js");
    app.register(fileRoutes);
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

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function deleteFile(
    fileId: string,
    userId: string,
    options: { force?: boolean } = {},
  ): Promise<ReturnType<typeof app.inject>> {
    const token = signTestToken(userId);
    const { csrfToken, csrfCookie } = await getCsrf();

    const url = options.force ? `/files/${fileId}?force=true` : `/files/${fileId}`;

    return app.inject({
      method: "DELETE",
      url,
      headers: {
        cookie: `token=${token}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
    });
  }

  // ── Test 1: File has no shares → 200 OK ──────────────────────────────────────
  it("returns 200 when file has no shares", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.file.findUnique).mockResolvedValue(makeFile({ shares: [] }) as never);

    const res = await deleteFile("file-1", OWNER_ID);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("File deleted successfully.");
    expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: "file-1" } });
  });

  // ── Test 2: File belongs to 1 share, no force → 409 ─────────────────────────
  it("returns 409 with shareCount when file belongs to 1 share and force is not set", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      makeFile({ shares: [{ id: "share-1" }] }) as never,
    );

    const res = await deleteFile("file-1", OWNER_ID);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.shareCount).toBe(1);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    // File must NOT have been deleted
    expect(prisma.file.delete).not.toHaveBeenCalled();
  });

  // ── Test 3: File belongs to 1 share + force=true → 200 OK ────────────────────
  it("returns 200 and deletes file when force=true even if file belongs to a share", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      makeFile({ shares: [{ id: "share-1" }] }) as never,
    );

    const res = await deleteFile("file-1", OWNER_ID, { force: true });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("File deleted successfully.");
    expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: "file-1" } });
  });

  // ── Test 4: Different user's file → 403 ──────────────────────────────────────
  it("returns 403 when deleting another user's file", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File owned by OWNER_ID, request from OTHER_USER_ID
    vi.mocked(prisma.file.findUnique).mockResolvedValue(makeFile({ shares: [] }) as never);

    const res = await deleteFile("file-1", OTHER_USER_ID);

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(prisma.file.delete).not.toHaveBeenCalled();
  });

  // ── Test 5: File not found → 404 ─────────────────────────────────────────────
  it("returns 404 when file does not exist", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.file.findUnique).mockResolvedValue(null);

    const res = await deleteFile("nonexistent-file", OWNER_ID);

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(prisma.file.delete).not.toHaveBeenCalled();
  });

  // ── Test 6: File belongs to multiple shares → 409 with correct shareCount ─────
  it("returns 409 with correct shareCount when file belongs to multiple shares", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      makeFile({ shares: [{ id: "share-1" }, { id: "share-2" }, { id: "share-3" }] }) as never,
    );

    const res = await deleteFile("file-1", OWNER_ID);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.shareCount).toBe(3);
  });
});
