/**
 * folder-delete-share-check.integration.test.ts
 *
 * Integration tests for the folder deletion share-check feature (B-24).
 *
 * Tests that DELETE /folders/:id returns 409 when the folder (or its contents)
 * belongs to shares and force is not set, and proceeds when force=true.
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
      findUnique: vi.fn().mockResolvedValue(null),
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
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    share: {
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
    $queryRaw: vi.fn(),
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

// ── Mock FolderService (avoid S3 dependency) ──────────────────────────────────
vi.mock("../modules/folder/service.js", () => ({
  FolderService: class MockFolderService {
    deleteObject = vi.fn().mockResolvedValue(undefined);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /folders/:id — share-check feature (B-24)", () => {
  let app: FastifyInstance;

  const OWNER_ID = "user-owner-1";
  const OTHER_USER_ID = "user-other-1";

  const makeFolder = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "folder-1",
    name: "My Folder",
    description: null,
    objectName: `${OWNER_ID}/folders/my-folder`,
    parentId: null,
    userId: OWNER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { folderRoutes } = await import("../modules/folder/routes.js");
    app.register(folderRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "folder-1" }] as never);
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

  async function deleteFolderRequest(
    folderId: string,
    userId: string,
    options: { force?: boolean } = {},
  ): Promise<ReturnType<typeof app.inject>> {
    const token = signTestToken(userId);
    const { csrfToken, csrfCookie } = await getCsrf();

    let url = `/folders/${folderId}`;
    if (options.force !== undefined) {
      url += `?force=${options.force}`;
    }

    return app.inject({
      method: "DELETE",
      url,
      headers: {
        cookie: `token=${token}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
    });
  }

  // ── Test 1: Folder has no shares → 200 OK ───────────────────────────────────
  it("returns 200 when folder has no shares", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);
    // share queries: no shares
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);

    const res = await deleteFolderRequest("folder-1", OWNER_ID);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("Folder deleted successfully.");
    expect(prisma.folder.delete).toHaveBeenCalledWith({ where: { id: "folder-1" } });
  });

  // ── Test 2: Folder referenced by 1 share, no force → 409 ───────────────────
  it("returns 409 with shareCount and error code when folder belongs to 1 share and force is not set", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);
    // share queries: folder directly in 1 share
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([{ id: "share-1" }] as never) // folders query
      .mockResolvedValueOnce([] as never); // files query

    const res = await deleteFolderRequest("folder-1", OWNER_ID);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("FOLDER_IN_SHARES");
    expect(body.shareCount).toBe(1);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    // Folder must NOT have been deleted
    expect(prisma.folder.delete).not.toHaveBeenCalled();
  });

  // ── Test 3: Folder belongs to 1 share + force=true → 200 OK ─────────────────
  it("returns 200 and deletes folder when force=true even if folder belongs to a share", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);
    // share queries: folder directly in 1 share
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([{ id: "share-1" }] as never) // folders query
      .mockResolvedValueOnce([] as never); // files query

    const res = await deleteFolderRequest("folder-1", OWNER_ID, { force: true });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("Folder deleted successfully.");
    expect(prisma.folder.delete).toHaveBeenCalledWith({ where: { id: "folder-1" } });
  });

  // ── Test 3b: Folder belongs to share + force=false → 409 ────────────────────
  it("returns 409 when folder belongs to a share and force=false is passed explicitly", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([{ id: "share-1" }] as never)
      .mockResolvedValueOnce([] as never);

    const res = await deleteFolderRequest("folder-1", OWNER_ID, { force: false });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("FOLDER_IN_SHARES");
    expect(body.shareCount).toBe(1);
    expect(prisma.folder.delete).not.toHaveBeenCalled();
  });

  // ── Test 4: Different user's folder → 403 ───────────────────────────────────
  it("returns 403 when deleting another user's folder", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // Folder owned by OWNER_ID, request from OTHER_USER_ID
    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);

    const res = await deleteFolderRequest("folder-1", OTHER_USER_ID);

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(prisma.folder.delete).not.toHaveBeenCalled();
  });

  // ── Test 5: Folder not found → 404 ──────────────────────────────────────────
  it("returns 404 when folder does not exist", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(null);

    const res = await deleteFolderRequest("nonexistent-folder", OWNER_ID);

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(prisma.folder.delete).not.toHaveBeenCalled();
  });

  // ── Test 6: Multiple shares (deduplication) → 409 with shareCount=3 ─────────
  it("returns 409 with correct shareCount when folder subtree spans multiple shares", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder() as never);
    // share queries: 2 via folder shares, 2 via file shares (1 duplicate)
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([{ id: "share-1" }, { id: "share-2" }] as never) // folders query
      .mockResolvedValueOnce([{ id: "share-2" }, { id: "share-3" }] as never); // files query

    const res = await deleteFolderRequest("folder-1", OWNER_ID);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    // share-2 appears in both but should be deduplicated → 3 unique shares
    expect(body.shareCount).toBe(3);
  });

  // ── Test 7: Multi-level subtree via CTE ─────────────────────────────────────
  it("checks shares recursively across all descendant folders using CTE", async () => {
    const { prisma } = await import("../shared/prisma.js");

    vi.mocked(prisma.folder.findUnique).mockResolvedValue(makeFolder({}) as never);

    // CTE returns the full subtree: root + child + grandchild
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { id: "folder-1" },
      { id: "child-1" },
      { id: "grandchild-1" },
    ] as never);

    // A share references the grandchild's file
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // no direct folder shares
      .mockResolvedValueOnce([{ id: "share-1" }] as never); // file in grandchild folder

    const res = await deleteFolderRequest("folder-1", OWNER_ID);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("FOLDER_IN_SHARES");
    expect(body.shareCount).toBe(1);
    expect(prisma.folder.delete).not.toHaveBeenCalled();
  });
});
