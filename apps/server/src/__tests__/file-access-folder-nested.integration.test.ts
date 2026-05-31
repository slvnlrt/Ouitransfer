/**
 * file-access-folder-nested.integration.test.ts
 *
 * Integration tests for folder-nested file access via shares (TD-35).
 *
 * Verifies that `checkFileAccess` and `trackShareDownload` correctly handle
 * files at any depth in a shared folder tree, not just direct file→share links.
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
      findFirst: vi.fn(),
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
    share: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    shareVisit: {
      create: vi.fn().mockResolvedValue({}),
    },
    reverseShareFile: {
      findFirst: vi.fn().mockResolvedValue(null),
      aggregate: vi.fn().mockResolvedValue({
        _sum: { size: null },
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
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
    getPresignedGetUrl = vi.fn().mockResolvedValue("https://s3.example.com/download");
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    getObjectStream = vi.fn().mockResolvedValue(Buffer.from("file content"));
    deleteObject = vi.fn().mockResolvedValue(undefined);
  },
}));

// ── Mock audit service ────────────────────────────────────────────────────────
vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock email service ────────────────────────────────────────────────────────
vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /files/download-url — folder-nested file access (TD-35)", () => {
  let app: FastifyInstance;

  const FILE_OWNER_ID = "user-owner-1";
  const FILE_ID = "file-1";
  const OBJECT_NAME = `${FILE_OWNER_ID}/document.pdf`;

  // Folder hierarchy: root-folder → sub-folder → deep-folder
  const ROOT_FOLDER_ID = "folder-root";
  const SUB_FOLDER_ID = "folder-sub";
  const DEEP_FOLDER_ID = "folder-deep";

  const SHARE_ID = "share-1";

  const makeFileRecord = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: FILE_ID,
    name: "document.pdf",
    description: null,
    extension: "pdf",
    size: BigInt(2048),
    objectName: OBJECT_NAME,
    userId: FILE_OWNER_ID,
    folderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeShare = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: SHARE_ID,
    name: "Test Share",
    creatorId: FILE_OWNER_ID,
    security: { password: null },
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

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function downloadUrl(
    objectName: string,
    options: { password?: string; shareId?: string } = {},
  ): Promise<ReturnType<typeof app.inject>> {
    const { csrfToken, csrfCookie } = await getCsrf();

    return app.inject({
      method: "POST",
      url: "/files/download-url",
      headers: {
        cookie: `_csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      payload: {
        objectName,
        ...(options.password && { password: options.password }),
        ...(options.shareId && { shareId: options.shareId }),
      },
    });
  }

  // ── Test 1: Direct file access (no folder) ──────────────────────────────────
  it("returns 200 for a file directly linked to a share (no folder)", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File has no folder → folderId is null
    const fileRecord = makeFileRecord({ folderId: null });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: null } as never);

    // No ancestor folders (folderId is null → getAncestorFolderIds returns [])
    // $queryRaw won't be called since folderId is null

    // Share directly links to this file
    vi.mocked(prisma.share.findMany).mockResolvedValue([makeShare()] as never);

    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();
    expect(body.expiresIn).toBeDefined();
  });

  // ── Test 2: Folder-nested file access (1 level) ─────────────────────────────
  it("returns 200 for a file in a folder that is shared (1 level deep)", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File is in ROOT_FOLDER_ID
    const fileRecord = makeFileRecord({ folderId: ROOT_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: ROOT_FOLDER_ID } as never);

    // Ancestor CTE: ROOT_FOLDER_ID is its own ancestor (it has no parent)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share links to ROOT_FOLDER_ID via folders relation
    vi.mocked(prisma.share.findMany).mockResolvedValue([makeShare()] as never);

    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();
  });

  // ── Test 3: Deeply nested file access (2+ levels) ──────────────────────────
  it("returns 200 for a file in a sub-sub-folder of a shared folder (deep nesting)", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File is in DEEP_FOLDER_ID (deepest level)
    const fileRecord = makeFileRecord({ folderId: DEEP_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: DEEP_FOLDER_ID } as never);

    // Ancestor CTE: DEEP_FOLDER_ID → SUB_FOLDER_ID → ROOT_FOLDER_ID
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: DEEP_FOLDER_ID },
      { id: SUB_FOLDER_ID },
      { id: ROOT_FOLDER_ID },
    ] as never);

    // Share links to ROOT_FOLDER_ID — ancestors include ROOT_FOLDER_ID
    vi.mocked(prisma.share.findMany).mockResolvedValue([makeShare()] as never);

    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();

    // Verify the share query used OR with ancestor folder IDs
    expect(prisma.share.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { files: { some: { id: FILE_ID } } },
            {
              folders: {
                some: { id: { in: [DEEP_FOLDER_ID, SUB_FOLDER_ID, ROOT_FOLDER_ID] } },
              },
            },
          ]),
        }),
      }),
    );
  });

  // ── Test 4: Unrelated file denied ───────────────────────────────────────────
  it("returns 401 for a file in a folder NOT linked to any share", async () => {
    const { prisma } = await import("../shared/prisma.js");

    const UNRELATED_FOLDER_ID = "folder-unrelated";

    // File is in an unrelated folder
    const fileRecord = makeFileRecord({ folderId: UNRELATED_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      folderId: UNRELATED_FOLDER_ID,
    } as never);

    // Ancestor CTE: just itself (no ancestors linked to any share)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: UNRELATED_FOLDER_ID }] as never);

    // No shares match — neither direct file link nor folder ancestor link
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);

    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  // ── Test 5: Password-protected share with folder — correct password ────────
  it("returns 200 for a folder-nested file with correct share password", async () => {
    const { prisma } = await import("../shared/prisma.js");
    const bcrypt = await import("bcryptjs");

    const hashedPassword = await bcrypt.default.hash("secret123", 10);

    // File is in ROOT_FOLDER_ID
    const fileRecord = makeFileRecord({ folderId: ROOT_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: ROOT_FOLDER_ID } as never);

    // Ancestor CTE: ROOT_FOLDER_ID only
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share with password protection, linked via folder
    vi.mocked(prisma.share.findMany).mockResolvedValue([
      makeShare({ security: { password: hashedPassword } }),
    ] as never);

    const res = await downloadUrl(OBJECT_NAME, { password: "secret123" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();
  });

  // ── Test 6: Password-protected share with folder — wrong password ──────────
  it("returns 401 for a folder-nested file with wrong share password", async () => {
    const { prisma } = await import("../shared/prisma.js");
    const bcrypt = await import("bcryptjs");

    const hashedPassword = await bcrypt.default.hash("secret123", 10);

    // File is in ROOT_FOLDER_ID
    const fileRecord = makeFileRecord({ folderId: ROOT_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: ROOT_FOLDER_ID } as never);

    // Ancestor CTE: ROOT_FOLDER_ID only
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share with password protection, linked via folder
    vi.mocked(prisma.share.findMany).mockResolvedValue([
      makeShare({ security: { password: hashedPassword } }),
    ] as never);

    const res = await downloadUrl(OBJECT_NAME, { password: "wrong-password" });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  // ── Test 7: trackShareDownload records visit for folder-nested file ────────
  it("calls trackShareDownload and creates ShareVisit for a folder-nested file", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File is in DEEP_FOLDER_ID (deeply nested)
    const fileRecord = makeFileRecord({ folderId: DEEP_FOLDER_ID });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: DEEP_FOLDER_ID } as never);

    // Ancestor CTE: DEEP → SUB → ROOT
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: DEEP_FOLDER_ID },
      { id: SUB_FOLDER_ID },
      { id: ROOT_FOLDER_ID },
    ] as never);

    // checkFileAccess: share links to ROOT_FOLDER_ID via ancestor match
    vi.mocked(prisma.share.findMany).mockResolvedValue([makeShare()] as never);

    // trackShareDownload: share.findFirst should match via folder branch
    vi.mocked(prisma.share.findFirst).mockResolvedValue({
      id: SHARE_ID,
      creatorId: "different-user",
      alias: null,
      creator: { email: "owner@test.com", locale: "en-US", isActive: true },
    } as never);

    const res = await downloadUrl(OBJECT_NAME, { shareId: SHARE_ID });

    expect(res.statusCode).toBe(200);

    // Verify trackShareDownload queried using the folder OR branch
    expect(prisma.share.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SHARE_ID,
          OR: expect.arrayContaining([
            { files: { some: { id: FILE_ID } } },
            {
              folders: {
                some: { id: { in: [DEEP_FOLDER_ID, SUB_FOLDER_ID, ROOT_FOLDER_ID] } },
              },
            },
          ]),
        }),
      }),
    );

    // Verify ShareVisit was created (download tracked)
    // Give fire-and-forget async a tick to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prisma.shareVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shareId: SHARE_ID,
          fileId: FILE_ID,
        }),
      }),
    );
  });

  // ── Test 8: File with no folderId and no share → 401 ───────────────────────
  it("returns 401 for a file with no folder and no share link", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File has no folder
    const fileRecord = makeFileRecord({ folderId: null });
    vi.mocked(prisma.file.findFirst).mockResolvedValue(fileRecord as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({ folderId: null } as never);

    // No shares match (no direct file link)
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);

    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(401);

    // Verify $queryRaw was NOT called (no folder → no ancestor lookup needed)
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
