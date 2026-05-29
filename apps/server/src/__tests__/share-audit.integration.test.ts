import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Track audit event creation ───────────────────────────────────────────────
const mockAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
const mockShareUpdate = vi.fn().mockResolvedValue({});
const mockShareUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockShareFindUnique = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue({ id: "creator-user", tokenVersion: 0 }),
    },
    share: {
      findUnique: mockShareFindUnique,
      update: mockShareUpdate,
      updateMany: mockShareUpdateMany,
    },
    shareRecipient: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    shareVisit: {
      create: vi.fn().mockResolvedValue({ id: "visit-1" }),
    },
    auditLog: { create: mockAuditCreate },
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

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeShare = (overrides: Record<string, unknown> = {}) => ({
  id: "share-abc",
  name: "Test Share",
  description: null,
  expiration: null,
  views: 0,
  maxViews: null,
  creatorId: "creator-user",
  securityId: "sec-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  nameFieldRequired: "HIDDEN",
  emailFieldRequired: "HIDDEN",
  inactivityAlertDays: null,
  inactivityAlertSent: false,
  lastDownloadedAt: null,
  notifyOnDownload: false,
  notifiedForExpiring: false,
  notifiedForExpired: false,
  files: [
    {
      id: "file-1",
      name: "test.txt",
      description: null,
      extension: "txt",
      size: BigInt(1024),
      objectName: "obj/test.txt",
      userId: "creator-user",
      folderId: null,
      shareId: "share-abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  folders: [],
  recipients: [],
  alias: null,
  creator: { email: "creator@example.com", locale: "en" },
  security: {
    id: "sec-1",
    password: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Share audit events — integration", () => {
  let app: FastifyInstance;

  const TOKEN_VERSION = 0;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { shareRoutes } = await import("../modules/share/routes.js");
    app.register(shareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults cleared by clearAllMocks
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    mockShareUpdate.mockResolvedValue({});
    mockShareUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("creates SHARE_ACCESS audit event for non-creator access", async () => {
    const share = makeShare();
    // findShareById is called twice: once for the initial lookup, once after incrementViews
    mockShareFindUnique.mockResolvedValue(share);
    // incrementViews calls prisma.share.update
    mockShareUpdate.mockResolvedValue({ ...share, views: 1 });

    // Access without auth token = anonymous non-creator
    const res = await app.inject({
      method: "GET",
      url: "/shares/share-abc",
    });

    expect(res.statusCode).toBe(200);

    // Should have called update to increment views
    expect(mockShareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "share-abc" },
        data: { views: { increment: 1 } },
      }),
    );

    // Flush microtask queue for fire-and-forget audit event to settle
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHARE_ACCESS",
          targetType: "share",
          targetId: "share-abc",
        }),
      }),
    );
  });

  it("does NOT create SHARE_ACCESS for creator access", async () => {
    const share = makeShare();
    // findShareById is called once for the initial lookup; creator path returns early
    mockShareFindUnique.mockResolvedValue(share);

    // Access WITH auth as creator
    const jwt = app.jwt.sign({
      userId: "creator-user",
      isAdmin: false,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/shares/share-abc",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);

    // Should NOT have called update (no view increment for creator)
    expect(mockShareUpdate).not.toHaveBeenCalled();

    // Flush microtask queue and verify no audit event
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "SHARE_ACCESS" }),
      }),
    );
  });

  it("creates SHARE_PASSWORD_FAILED audit event on wrong password", async () => {
    // Real bcrypt hash of "correct-password" — we'll send "wrong-password"
    const share = makeShare({
      security: {
        id: "sec-1",
        password: "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh8i",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    mockShareFindUnique.mockResolvedValue(share);

    const res = await app.inject({
      method: "POST",
      url: "/shares/share-abc/access",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ password: "wrong-password" }),
    });

    expect(res.statusCode).toBe(401);

    // Flush microtask queue for fire-and-forget audit event to settle
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHARE_PASSWORD_FAILED",
          targetType: "share",
          targetId: "share-abc",
        }),
      }),
    );
  });

  describe("maxViews concurrency", () => {
    it("allows exactly maxViews successful accesses with concurrent requests", async () => {
      const MAX_VIEWS = 5;
      const CONCURRENT_REQUESTS = 10;
      let currentViews = 0;

      const share = makeShare({
        id: "share-concurrent",
        maxViews: MAX_VIEWS,
        views: 0,
        creatorId: "other-user", // not the requester, so non-creator path
      });

      // findUnique returns current view count on each call
      mockShareFindUnique.mockImplementation(async () => ({
        ...share,
        views: currentViews,
      }));

      // updateMany simulates atomic check-and-increment:
      // only succeed if currentViews < maxViews (serialised inside the mock)
      mockShareUpdateMany.mockImplementation(async () => {
        if (currentViews < MAX_VIEWS) {
          currentViews++;
          return { count: 1 };
        }
        return { count: 0 };
      });

      // auditLog.create is fire-and-forget; resolve immediately
      mockAuditCreate.mockResolvedValue({ id: "audit-concurrent" });

      // Fire 10 concurrent requests (no auth = anonymous non-creator)
      const requests = Array.from({ length: CONCURRENT_REQUESTS }, () =>
        app.inject({
          method: "GET",
          url: "/shares/share-concurrent",
        }),
      );

      const responses = await Promise.all(requests);
      const successes = responses.filter((r) => r.statusCode === 200);
      const failures = responses.filter((r) => r.statusCode === 410);

      expect(successes).toHaveLength(MAX_VIEWS);
      expect(failures).toHaveLength(CONCURRENT_REQUESTS - MAX_VIEWS);
    });
  });
});
