import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Track audit event creation ───────────────────────────────────────────────
const mockAuditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
const mockShareUpdate = vi.fn().mockResolvedValue({});
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

    // Wait a tick for fire-and-forget to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
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

    // Wait and verify no audit event
    await new Promise((resolve) => setTimeout(resolve, 50));
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

    // Wait for fire-and-forget
    await new Promise((resolve) => setTimeout(resolve, 50));
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
});
