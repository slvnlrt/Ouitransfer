/**
 * share-download-access.integration.test.ts (R2)
 *
 * Full request-lifecycle integration tests (app.inject) for the R2 download/access
 * hardening:
 *  - A2-01: IDOR — a user cannot add another user's files/folders to their own share.
 *  - A4-02 / A2-04: a share-bound download is denied when the share is expired / paused /
 *    max-views-reached / owner-inactive (the lifecycle gate is enforced on the byte path).
 *  - A4-03: per-share password brute-force lockout on the password-bearing download endpoint.
 *  - Wrong-share token and raw-anonymous-key rejection.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted prisma mock fns ───────────────────────────────────────────────────
const {
  mockFileFindMany,
  mockFolderFindMany,
  mockShareFindUnique,
  mockShareFindFirst,
  mockShareUpdate,
  mockFileFindUnique,
  mockFileFindFirst,
  mockLoginAttemptFindMany,
  mockLoginAttemptCreate,
} = vi.hoisted(() => ({
  mockFileFindMany: vi.fn(),
  mockFolderFindMany: vi.fn(),
  mockShareFindUnique: vi.fn(),
  mockShareFindFirst: vi.fn(),
  mockShareUpdate: vi.fn().mockResolvedValue({}),
  mockFileFindUnique: vi.fn(),
  mockFileFindFirst: vi.fn(),
  mockLoginAttemptFindMany: vi.fn().mockResolvedValue([]),
  mockLoginAttemptCreate: vi.fn().mockResolvedValue({}),
}));

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue({ id: "user-A", tokenVersion: 0 }),
    },
    share: {
      findUnique: mockShareFindUnique,
      findFirst: mockShareFindFirst,
      findMany: vi.fn().mockResolvedValue([]),
      update: mockShareUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    file: {
      findUnique: mockFileFindUnique,
      findFirst: mockFileFindFirst,
      findMany: mockFileFindMany,
    },
    folder: { findMany: mockFolderFindMany },
    shareAlias: { findUnique: vi.fn().mockResolvedValue(null) },
    shareRecipient: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    shareVisit: { create: vi.fn().mockResolvedValue({}) },
    loginAttempt: { findMany: mockLoginAttemptFindMany, create: mockLoginAttemptCreate },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: { send: vi.fn().mockResolvedValue(undefined), sendToAdmins: vi.fn() },
}));

vi.mock("../modules/file/service.js", () => ({
  FileService: class {
    getPresignedGetUrl = vi.fn().mockResolvedValue("https://s3.example/download");
    getObjectStream = vi.fn().mockResolvedValue(Buffer.from("bytes"));
    getPresignedPutUrl = vi.fn();
    getObjectHead = vi.fn();
    deleteObject = vi.fn();
  },
}));

const OWNER_A = "user-A";
const _OWNER_B = "user-B";
const SHARE_ID = "share-1";
const FILE_A = "file-A";
const FILE_B = "file-B";
const OBJECT_A = `${OWNER_A}/a.pdf`;

describe("R2 download/access hardening — integration", () => {
  let app: FastifyInstance;
  let shareFileToken: string;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { shareRoutes } = await import("../modules/share/routes.js");
    const { fileRoutes } = await import("../modules/file/routes.js");
    app.register(shareRoutes);
    app.register(fileRoutes);
    await app.ready();

    const { mintShareFileToken } = await import("../modules/share/share-file-token.js");
    shareFileToken = mintShareFileToken(SHARE_ID, FILE_A);
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoginAttemptFindMany.mockResolvedValue([]);
  });

  function fileRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: FILE_A,
      name: "a.pdf",
      description: null,
      extension: "pdf",
      size: BigInt(2048),
      objectName: OBJECT_A,
      userId: OWNER_A,
      folderId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function shareRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: SHARE_ID,
      name: "Share",
      creatorId: OWNER_A,
      isActive: true,
      deactivationReason: null,
      expiration: null,
      maxViews: null,
      views: 0,
      security: { password: null },
      creator: { isActive: true },
      ...overrides,
    };
  }

  async function csrf() {
    const r = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = r.json();
    const cookie = r.cookies.find((c: { name: string }) => c.name === "_csrf");
    return { token, cookie: cookie!.value };
  }

  function jwtFor(userId: string) {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function downloadUrl(key: string, password?: string) {
    const { token, cookie } = await csrf();
    return app.inject({
      method: "POST",
      url: "/files/download-url",
      headers: {
        "content-type": "application/json",
        cookie: `_csrf=${cookie}`,
        "x-csrf-token": token,
      },
      payload: { objectName: key, ...(password ? { password } : {}) },
    });
  }

  // ── A2-01 IDOR ──────────────────────────────────────────────────────────────
  describe("A2-01 — addItemsToShare ownership scoping", () => {
    it("returns 404 and does NOT connect when user A adds user B's fileId", async () => {
      // A owns the share.
      mockShareFindUnique.mockResolvedValue(shareRecord());
      // The ownership-scoped lookup (where userId=A) returns [] — B's file is not A's → not found.
      mockFileFindMany.mockResolvedValue([]);

      const { token, cookie } = await csrf();
      const res = await app.inject({
        method: "POST",
        url: `/shares/${SHARE_ID}/items`,
        headers: {
          "content-type": "application/json",
          cookie: `_csrf=${cookie}; token=${jwtFor(OWNER_A)}`,
          "x-csrf-token": token,
        },
        payload: { files: [FILE_B] },
      });

      expect(res.statusCode).toBe(404);
      // The connect (share.update) must never have happened.
      expect(mockShareUpdate).not.toHaveBeenCalled();
      // The lookup was scoped to the caller (userId on the where clause).
      expect(mockFileFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: OWNER_A, id: { in: [FILE_B] } }),
        }),
      );
    });
  });

  // ── A4-02 / A2-04 lifecycle gate on download ─────────────────────────────────
  describe("A4-02 — share lifecycle gate on the download path", () => {
    it("denies download when the bound share is expired (by date)", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(
        shareRecord({ expiration: new Date(Date.now() - 1000) }),
      );
      const res = await downloadUrl(shareFileToken);
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("SHARE_EXPIRED");
    });

    it("denies download when the bound share is paused (manual deactivation)", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(
        shareRecord({ isActive: false, deactivationReason: "manual" }),
      );
      const res = await downloadUrl(shareFileToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("SHARE_INACTIVE");
    });

    it("denies download when the bound share has reached max views", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(shareRecord({ maxViews: 1, views: 1 }));
      const res = await downloadUrl(shareFileToken);
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("MAX_VIEWS_REACHED");
    });

    it("denies download when the share owner is inactive", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(shareRecord({ creator: { isActive: false } }));
      const res = await downloadUrl(shareFileToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("OWNER_INACTIVE");
    });

    it("allows download for an active, in-window share", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(shareRecord());
      const res = await downloadUrl(shareFileToken);
      expect(res.statusCode).toBe(200);
      expect(res.json().url).toBeDefined();
    });
  });

  // ── A4-02 root: raw-key and wrong-share-token rejection ──────────────────────
  describe("A4-02 — raw key & wrong-share token", () => {
    it("rejects a raw objectName from an anonymous caller (401)", async () => {
      mockFileFindFirst.mockResolvedValue(fileRecord());
      const res = await downloadUrl(OBJECT_A);
      expect(res.statusCode).toBe(401);
    });

    it("allows a raw objectName download for the JWT owner", async () => {
      mockFileFindFirst.mockResolvedValue(fileRecord());
      const { token, cookie } = await csrf();
      const res = await app.inject({
        method: "POST",
        url: "/files/download-url",
        headers: {
          "content-type": "application/json",
          cookie: `_csrf=${cookie}; token=${jwtFor(OWNER_A)}`,
          "x-csrf-token": token,
        },
        payload: { objectName: OBJECT_A },
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects a token for share A when the file is not in share A (404)", async () => {
      const { mintShareFileToken } = await import("../modules/share/share-file-token.js");
      const wrongToken = mintShareFileToken("share-OTHER", FILE_A);
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(null); // share-OTHER does not contain the file
      const res = await downloadUrl(wrongToken);
      expect(res.statusCode).toBe(404);
      expect(mockShareFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: "share-OTHER" }) }),
      );
    });
  });

  // ── A4-03 per-share password lockout on the download path ────────────────────
  describe("A4-03 — per-share password lockout on download", () => {
    it("returns 429 SHARE_LOCKED when the share's password attempts are locked out", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(shareRecord({ security: { password: "$2b$10$hash" } }));
      // 5 recent consecutive failures → locked.
      mockLoginAttemptFindMany.mockResolvedValue(
        Array.from({ length: 5 }, () => ({ success: false, createdAt: new Date() })),
      );
      const res = await downloadUrl(shareFileToken, "guess");
      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe("SHARE_LOCKED");
    });

    it("records a failed attempt and returns 401 on a wrong password (not locked yet)", async () => {
      mockFileFindUnique.mockResolvedValue(fileRecord());
      mockShareFindFirst.mockResolvedValue(shareRecord({ security: { password: "$2b$10$hash" } }));
      mockLoginAttemptFindMany.mockResolvedValue([]);
      const res = await downloadUrl(shareFileToken, "wrong");
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("INVALID_PASSWORD");
      // A failure was recorded for the share lockout counter.
      expect(mockLoginAttemptCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: `share:${SHARE_ID}`, success: false }),
        }),
      );
    });
  });
});
