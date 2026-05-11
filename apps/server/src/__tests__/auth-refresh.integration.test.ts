import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma before any imports that use it
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn() },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordReset: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// ConfigService must be a class with `new ConfigService()` usage
vi.mock("../modules/config/service.js", () => ({
  ConfigService: class MockConfigService {
    getValue = vi.fn().mockResolvedValue("true");
    validateAllProvidersDisable = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

describe("POST /auth/refresh — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    // Register auth routes (includes /auth/refresh)
    const { authRoutes } = await import("../modules/auth/routes.js");
    app.register(authRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is CSRF-exempt (no X-CSRF-Token required)", async () => {
    // Even without CSRF token, should NOT get 403 (CSRF).
    // It may get 401 (invalid token) — that's fine, we just check it's not 403.
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ refreshToken: "some-token" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 401 when body and cookie both missing refresh token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Missing refresh token");
  });

  it("validates body schema — rejects non-string refreshToken", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ refreshToken: 12345 }),
    });
    // Zod validation failure → 400
    expect(res.statusCode).toBe(400);
  });

  it("accepts refresh token from body (password-login flow)", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      token: "valid-body-token",
      userId: "user-1",
      userAgent: "TestAgent",
      ipAddress: "127.0.0.1",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: true },
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      {},
      { id: "rt-2", token: "new-token-value", userId: "user-1" },
    ] as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ refreshToken: "valid-body-token" }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).toBe("new-token-value");

    // Should set the access token cookie
    const cookies = res.cookies;
    const tokenCookie = cookies.find((c: { name: string }) => c.name === "token");
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.httpOnly).toBe(true);

    // Should also set the refresh_token cookie
    const refreshCookie = cookies.find((c: { name: string }) => c.name === "refresh_token");
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe("/api/auth/refresh");
  });

  it("accepts refresh token from cookie (OIDC flow)", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-3",
      token: "cookie-based-token",
      userId: "user-2",
      userAgent: "OIDCAgent",
      ipAddress: "10.0.0.1",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-2", tokenVersion: 1, isAdmin: true, isActive: true },
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      {},
      { id: "rt-4", token: "new-oidc-token", userId: "user-2" },
    ] as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        "content-type": "application/json",
        cookie: "refresh_token=cookie-based-token",
      },
      payload: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).toBe("new-oidc-token");
  });

  it("returns 401 for invalid refresh token", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ refreshToken: "nonexistent-token" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Invalid refresh token");
  });

  it("returns 401 on replay (already-revoked token)", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-5",
      token: "replayed-token",
      userId: "user-1",
      revokedAt: new Date(), // already revoked
      replacedBy: "some-other",
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: true },
    } as never);
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 5 } as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ refreshToken: "replayed-token" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Refresh token reuse");
  });

  it("body refreshToken takes precedence over cookie", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-6",
      token: "body-token",
      userId: "user-3",
      userAgent: "Agent",
      ipAddress: "1.2.3.4",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-3", tokenVersion: 0, isAdmin: false, isActive: true },
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      {},
      { id: "rt-7", token: "new-from-body", userId: "user-3" },
    ] as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        "content-type": "application/json",
        cookie: "refresh_token=cookie-token",
      },
      payload: JSON.stringify({ refreshToken: "body-token" }),
    });

    expect(res.statusCode).toBe(200);
    // Verify that findUnique was called with the body token, not the cookie token
    expect(vi.mocked(prisma.refreshToken.findUnique)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: "body-token" },
      }),
    );
  });
});
