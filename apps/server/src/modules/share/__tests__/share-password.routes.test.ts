/**
 * share-password.routes.test.ts
 *
 * Integration tests for the share password update route:
 *   PATCH /shares/:shareId/password
 *
 * Exercises the full request lifecycle (JWT cookie + CSRF) so the route↔schema
 * wiring and owner-auth handling are verified end-to-end, not just at the
 * service layer (CLAUDE.md rules 10/11).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockShareFindUnique, mockShareUpdate, mockShareSecurityUpdate, mockUserCount } = vi.hoisted(
  () => ({
    mockShareFindUnique: vi.fn(),
    mockShareUpdate: vi.fn(),
    mockShareSecurityUpdate: vi.fn(),
    mockUserCount: vi.fn().mockResolvedValue(1),
  }),
);

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
    shareSecurity: {
      update: mockShareSecurityUpdate,
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

describe("PATCH /shares/:shareId/password — integration", () => {
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
    mockShareSecurityUpdate.mockImplementation(async () => ({
      id: SECURITY_ID,
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
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

  async function patch(url: string, userId: string, body: Record<string, unknown>) {
    const { csrfToken, csrfCookie } = await getCsrf();
    return app.inject({
      method: "PATCH",
      url,
      headers: {
        cookie: `token=${signToken(userId)}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  // ── Test cases ────────────────────────────────────────────────────────────────

  it("sets a new password for the owner (200)", async () => {
    mockShareFindUnique
      .mockResolvedValueOnce(
        makeShare({
          security: {
            id: SECURITY_ID,
            password: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      )
      .mockResolvedValue(
        makeShare({
          security: {
            id: SECURITY_ID,
            password: "hashed_password",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );

    mockShareSecurityUpdate.mockResolvedValue({
      id: SECURITY_ID,
      password: "hashed_password",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await patch(`/shares/${SHARE_ID}/password`, CREATOR_ID, { password: "newpass" });

    expect(res.statusCode).toBe(200);
    const { share } = res.json();
    expect(share.security.hasPassword).toBe(true);
    expect(mockShareSecurityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SECURITY_ID },
        data: expect.objectContaining({
          password: expect.any(String),
        }),
      }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_PASSWORD_UPDATE",
        metadata: { passwordCleared: false },
      }),
    );
  });

  it("clears the password when null is sent (200)", async () => {
    mockShareFindUnique
      .mockResolvedValueOnce(
        makeShare({
          security: {
            id: SECURITY_ID,
            password: "old_hash",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      )
      .mockResolvedValue(
        makeShare({
          security: {
            id: SECURITY_ID,
            password: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );

    mockShareSecurityUpdate.mockResolvedValue({
      id: SECURITY_ID,
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await patch(`/shares/${SHARE_ID}/password`, CREATOR_ID, { password: null });

    expect(res.statusCode).toBe(200);
    const { share } = res.json();
    expect(share.security.hasPassword).toBe(false);
    expect(mockShareSecurityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SECURITY_ID },
        data: expect.objectContaining({
          password: null,
        }),
      }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_PASSWORD_UPDATE",
        metadata: { passwordCleared: true },
      }),
    );
  });

  it("returns 403 when a non-owner tries to update the password", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());

    const res = await patch(`/shares/${SHARE_ID}/password`, OTHER_ID, { password: "newpass" });

    expect(res.statusCode).toBe(403);
    expect(mockShareSecurityUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the share does not exist", async () => {
    mockShareFindUnique.mockResolvedValue(null);

    const res = await patch(`/shares/${SHARE_ID}/password`, CREATOR_ID, { password: "newpass" });

    expect(res.statusCode).toBe(404);
    expect(mockShareSecurityUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { csrfToken, csrfCookie } = await getCsrf();
    const res = await app.inject({
      method: "PATCH",
      url: `/shares/${SHARE_ID}/password`,
      headers: {
        cookie: `_csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "newpass" }),
    });

    expect(res.statusCode).toBe(401);
    expect(mockShareSecurityUpdate).not.toHaveBeenCalled();
  });
});
