/**
 * pause-resume.routes.test.ts
 *
 * Phase A.1 Batch 4 — `app.inject()` integration tests for the manual
 * pause/resume share routes:
 *   - PATCH /shares/:shareId/pause   (owner → 200, share deactivated reason "manual")
 *   - PATCH /shares/:shareId/resume  (owner → 200, share reactivated)
 *   - resume refused → 400 when the share is still expired / maxed
 *   - non-owner → 403 on both routes
 *
 * Exercises the full request lifecycle (JWT cookie + CSRF) so the route↔schema
 * wiring and owner-auth handling are verified end-to-end, not just at the
 * service layer (CLAUDE.md rules 10/11).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockShareFindUnique, mockShareUpdate, mockUserCount } = vi.hoisted(() => ({
  mockShareFindUnique: vi.fn(),
  mockShareUpdate: vi.fn(),
  mockUserCount: vi.fn().mockResolvedValue(1),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: vi.fn(),
    },
    share: {
      findUnique: mockShareFindUnique,
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: mockShareUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
    },
    shareAlias: {
      findUnique: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: vi.fn().mockResolvedValue({ enqueued: false }) },
}));

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../../../modules/quota/service.js", () => ({
  quotaService: {
    resolveEffectiveLimits: vi.fn().mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 0n }),
    calculateStorageUsed: vi.fn().mockResolvedValue(0n),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    getPresignedGetUrl = vi.fn().mockResolvedValue("https://presigned.url/test.txt");
    getPresignedPutUrl = vi.fn().mockResolvedValue("https://presigned.url/upload");
    getObjectStream = vi.fn();
    getObjectHead = vi.fn();
    deleteObject = vi.fn();
    createMultipartUpload = vi.fn();
    getPresignedPartUrl = vi.fn();
    completeMultipartUpload = vi.fn();
    abortMultipartUpload = vi.fn();
    listParts = vi.fn();
  },
}));

// ─── Static imports (after vi.mock hoisting) ─────────────────────────────────

import { logAuditEvent } from "../../audit/service.js";

// ─── Test data helpers ────────────────────────────────────────────────────────

const CREATOR_ID = "creator-user-1";
const OTHER_ID = "other-user-1";
const SHARE_ID = "share-1";
const SECURITY_ID = "security-1";

function makeShare(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    name: "Test Share",
    description: null,
    views: 0,
    maxViews: null,
    expiration: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: CREATOR_ID,
    securityId: SECURITY_ID,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    inactivityAlertDays: null,
    inactivityAlertSent: false,
    lastDownloadedAt: null,
    notifyOnDownload: false,
    notifiedForMaxViews: false,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    notifiedForPendingDeletion: false,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    security: { id: SECURITY_ID, password: null, createdAt: new Date(), updatedAt: new Date() },
    files: [],
    folders: [],
    recipients: [],
    alias: null,
    creator: { email: "creator@example.com", locale: "en", isActive: true },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Share pause/resume routes — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const { shareRoutes } = await import("../routes.js");
    app.register(shareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(1);
    mockShareUpdate.mockImplementation(async () => makeShare());
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signToken(userId: string): string {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function patch(url: string, userId: string) {
    const { csrfToken, csrfCookie } = await getCsrf();
    return app.inject({
      method: "PATCH",
      url,
      headers: {
        cookie: `token=${signToken(userId)}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
    });
  }

  // ── PATCH /shares/:shareId/pause ──────────────────────────────────────────

  describe("PATCH /shares/:shareId/pause", () => {
    it("deactivates the share with reason 'manual' for the owner (200)", async () => {
      mockShareFindUnique
        .mockResolvedValueOnce(makeShare()) // findShareById: ownership + state check
        .mockResolvedValue(
          makeShare({
            isActive: false,
            deactivatedAt: new Date("2024-02-01"),
            deactivationReason: "manual",
          }),
        ); // re-read after update

      const res = await patch(`/shares/${SHARE_ID}/pause`, CREATOR_ID);

      expect(res.statusCode).toBe(200);
      const { share } = res.json();
      expect(share.isActive).toBe(false);
      expect(share.deactivationReason).toBe("manual");
      expect(share.deactivatedAt).not.toBeNull();
      // update was called with the deactivation fields
      expect(mockShareUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SHARE_ID },
          data: expect.objectContaining({
            isActive: false,
            deactivationReason: "manual",
          }),
        }),
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SHARE_DEACTIVATED", metadata: { reason: "manual" } }),
      );
    });

    it("returns 403 for a non-owner", async () => {
      mockShareFindUnique.mockResolvedValue(makeShare());

      const res = await patch(`/shares/${SHARE_ID}/pause`, OTHER_ID);

      expect(res.statusCode).toBe(403);
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when the share does not exist", async () => {
      mockShareFindUnique.mockResolvedValue(null);

      const res = await patch(`/shares/${SHARE_ID}/pause`, CREATOR_ID);

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /shares/:shareId/resume ─────────────────────────────────────────

  describe("PATCH /shares/:shareId/resume", () => {
    it("reactivates a manually-paused share for the owner (200)", async () => {
      mockShareFindUnique
        .mockResolvedValueOnce(
          makeShare({
            isActive: false,
            deactivatedAt: new Date("2024-02-01"),
            deactivationReason: "manual",
          }),
        )
        .mockResolvedValue(makeShare()); // re-read after update → active again

      const res = await patch(`/shares/${SHARE_ID}/resume`, CREATOR_ID);

      expect(res.statusCode).toBe(200);
      const { share } = res.json();
      expect(share.isActive).toBe(true);
      expect(share.deactivationReason).toBeNull();
      expect(mockShareUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SHARE_ID },
          data: expect.objectContaining({
            isActive: true,
            deactivatedAt: null,
            deactivationReason: null,
            notifiedForPendingDeletion: false,
          }),
        }),
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SHARE_REACTIVATED" }),
      );
    });

    it("refuses to resume a still-expired share (400) without updating it", async () => {
      mockShareFindUnique.mockResolvedValue(
        makeShare({
          isActive: false,
          deactivatedAt: new Date("2020-01-01"),
          deactivationReason: "expired",
          expiration: new Date("2020-01-01"), // in the past
        }),
      );

      const res = await patch(`/shares/${SHARE_ID}/resume`, CREATOR_ID);

      expect(res.statusCode).toBe(400);
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("refuses to resume a still-maxed share (400) without updating it", async () => {
      mockShareFindUnique.mockResolvedValue(
        makeShare({
          isActive: false,
          deactivatedAt: new Date("2024-02-01"),
          deactivationReason: "max_views",
          maxViews: 5,
          views: 5,
        }),
      );

      const res = await patch(`/shares/${SHARE_ID}/resume`, CREATOR_ID);

      expect(res.statusCode).toBe(400);
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("returns 403 for a non-owner", async () => {
      mockShareFindUnique.mockResolvedValue(
        makeShare({ isActive: false, deactivationReason: "manual" }),
      );

      const res = await patch(`/shares/${SHARE_ID}/resume`, OTHER_ID);

      expect(res.statusCode).toBe(403);
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when the share does not exist", async () => {
      mockShareFindUnique.mockResolvedValue(null);

      const res = await patch(`/shares/${SHARE_ID}/resume`, CREATOR_ID);

      expect(res.statusCode).toBe(404);
    });
  });
});
