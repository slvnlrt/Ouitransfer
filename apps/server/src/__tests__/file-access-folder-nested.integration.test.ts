/**
 * file-access-folder-nested.integration.test.ts
 *
 * Integration tests for folder-nested file access via shares.
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
    loginAttempt: {
      findMany: vi.fn().mockResolvedValue([]),
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

describe("POST /files/download-url — folder-nested file access", () => {
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

  // Share returned by `prisma.share.findFirst` in resolveDownloadTarget — includes the
  // lifecycle fields assertShareAccessible reads (isActive/expiration/maxViews/views) plus
  // security + creator.isActive.
  const makeShare = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: SHARE_ID,
    name: "Test Share",
    creatorId: FILE_OWNER_ID,
    isActive: true,
    deactivationReason: null,
    expiration: null,
    maxViews: null,
    views: 0,
    security: { password: null },
    creator: { isActive: true },
    ...overrides,
  });

  // The opaque per-share file token is the download handle for share visitors.
  let shareFileToken: string;

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

    const { mintShareFileToken } = await import("../modules/share/share-file-token.js");
    shareFileToken = mintShareFileToken(SHARE_ID, FILE_ID);
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
    key: string,
    options: { password?: string } = {},
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
        objectName: key,
        ...(options.password && { password: options.password }),
      },
    });
  }

  // ── Test 1: Direct file access (no folder) ──────────────────────────────────
  it("returns 200 for a file directly linked to a share (no folder)", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File has no folder → folderId is null. The token resolver loads it by id.
    const fileRecord = makeFileRecord({ folderId: null });
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // The token's share binding matches: share.findFirst returns the (active) share directly
    // linking this file.
    vi.mocked(prisma.share.findFirst).mockResolvedValue(makeShare() as never);

    const res = await downloadUrl(shareFileToken);

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
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: ROOT_FOLDER_ID is its own ancestor (it has no parent)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share links to ROOT_FOLDER_ID via folders relation — share.findFirst matches the OR branch.
    vi.mocked(prisma.share.findFirst).mockResolvedValue(makeShare() as never);

    const res = await downloadUrl(shareFileToken);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();
  });

  // ── Test 3: Deeply nested file access (2+ levels) ──────────────────────────
  it("returns 200 for a file in a sub-sub-folder of a shared folder (deep nesting)", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File is in DEEP_FOLDER_ID (deepest level)
    const fileRecord = makeFileRecord({ folderId: DEEP_FOLDER_ID });
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: DEEP_FOLDER_ID → SUB_FOLDER_ID → ROOT_FOLDER_ID
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: DEEP_FOLDER_ID },
      { id: SUB_FOLDER_ID },
      { id: ROOT_FOLDER_ID },
    ] as never);

    // Share links to ROOT_FOLDER_ID — ancestors include ROOT_FOLDER_ID
    vi.mocked(prisma.share.findFirst).mockResolvedValue(makeShare() as never);

    const res = await downloadUrl(shareFileToken);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBeDefined();

    // Verify the share query bound the token's shareId AND used OR with ancestor folder IDs.
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
  });

  // ── Test 4: Unrelated file denied ───────────────────────────────────────────
  it("returns 404 when the token's file no longer belongs to the bound share", async () => {
    const { prisma } = await import("../shared/prisma.js");

    const UNRELATED_FOLDER_ID = "folder-unrelated";

    // File is in an unrelated folder
    const fileRecord = makeFileRecord({ folderId: UNRELATED_FOLDER_ID });
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: just itself (no ancestors linked to any share)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: UNRELATED_FOLDER_ID }] as never);

    // The bound share no longer contains this file (item removed / share deleted) → null →
    // resolver treats it as not found.
    vi.mocked(prisma.share.findFirst).mockResolvedValue(null as never);

    const res = await downloadUrl(shareFileToken);

    expect(res.statusCode).toBe(404);
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
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: ROOT_FOLDER_ID only
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share with password protection, linked via folder
    vi.mocked(prisma.share.findFirst).mockResolvedValue(
      makeShare({ security: { password: hashedPassword } }) as never,
    );
    // No prior failed attempts → not locked out.
    vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue([] as never);

    const res = await downloadUrl(shareFileToken, { password: "secret123" });

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
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: ROOT_FOLDER_ID only
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: ROOT_FOLDER_ID }] as never);

    // Share with password protection, linked via folder
    vi.mocked(prisma.share.findFirst).mockResolvedValue(
      makeShare({ security: { password: hashedPassword } }) as never,
    );
    vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue([] as never);

    const res = await downloadUrl(shareFileToken, { password: "wrong-password" });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  // ── Test 7: trackShareDownload records visit for folder-nested file ────────
  it("calls trackShareDownload and creates ShareVisit for a folder-nested file", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File is in DEEP_FOLDER_ID (deeply nested)
    const fileRecord = makeFileRecord({ folderId: DEEP_FOLDER_ID });
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Ancestor CTE: DEEP → SUB → ROOT
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: DEEP_FOLDER_ID },
      { id: SUB_FOLDER_ID },
      { id: ROOT_FOLDER_ID },
    ] as never);

    // resolveDownloadTarget: the access share.findFirst (with security/creator) matches the
    // folder branch and is owned by a DIFFERENT user (so the download is tracked, not skipped
    // as an owner self-download); trackShareDownload's own share.findFirst returns the
    // tracking-shaped record.
    vi.mocked(prisma.share.findFirst)
      .mockResolvedValueOnce(makeShare({ creatorId: "different-user" }) as never)
      .mockResolvedValueOnce({
        id: SHARE_ID,
        creatorId: "different-user",
        alias: null,
        creator: { email: "owner@test.com", locale: "en-US", isActive: true },
      } as never);

    const res = await downloadUrl(shareFileToken);

    expect(res.statusCode).toBe(200);

    // Verify the access query bound the token's shareId AND used the folder OR branch.
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

  // ── Test 8: token's file no longer in the bound share → 404 ─────────────────
  it("returns 404 for a no-folder file whose bound share no longer links it", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // File has no folder
    const fileRecord = makeFileRecord({ folderId: null });
    vi.mocked(prisma.file.findUnique).mockResolvedValue(fileRecord as never);

    // Bound share does not link this file → null
    vi.mocked(prisma.share.findFirst).mockResolvedValue(null as never);

    const res = await downloadUrl(shareFileToken);

    expect(res.statusCode).toBe(404);

    // Verify $queryRaw was NOT called (no folder → no ancestor lookup needed)
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // ── Test 9: raw objectName from an anonymous caller is rejected (A4-02 root fix) ───
  it("returns 401 for a raw objectName supplied by an anonymous (non-owner) caller", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // The raw key path loads via file.findFirst({ objectName }).
    vi.mocked(prisma.file.findFirst).mockResolvedValue(makeFileRecord({ folderId: null }) as never);

    // No JWT → not the owner → denied. A password-less share existing is now irrelevant:
    // a bare objectName never grants anonymous access.
    const res = await downloadUrl(OBJECT_NAME);

    expect(res.statusCode).toBe(401);
  });

  // ── Test 10: wrong-share token cannot reach a file in a different share ──────
  it("returns 404 when a token for share A is used but the file is not in share A", async () => {
    const { prisma } = await import("../shared/prisma.js");
    const { mintShareFileToken } = await import("../modules/share/share-file-token.js");

    // Token binds FILE_ID to a DIFFERENT share id than the one that actually contains it.
    const wrongShareToken = mintShareFileToken("share-OTHER", FILE_ID);

    vi.mocked(prisma.file.findUnique).mockResolvedValue(
      makeFileRecord({ folderId: null }) as never,
    );
    // share.findFirst is scoped to id="share-OTHER" which does not contain the file → null.
    vi.mocked(prisma.share.findFirst).mockResolvedValue(null as never);

    const res = await downloadUrl(wrongShareToken);

    expect(res.statusCode).toBe(404);
    // The query was scoped to the token's (wrong) share id.
    expect(prisma.share.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "share-OTHER" }),
      }),
    );
  });
});
