import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma before any imports that use it
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordReset: { findFirst: vi.fn() },
  },
}));

// Mock config functions used during auth route registration and request handling.
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  setConfigValue: vi.fn().mockResolvedValue(undefined),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
  getGroupConfigs: vi.fn().mockResolvedValue({}),
}));

// ── Item 6: Do NOT mock validateTokenVersion ─────────────────────────────────
// Instead, ensure every test JWT includes a tokenVersion that matches what
// prisma.user.findUnique returns. This exercises the real validateTokenVersion
// code path through the full request lifecycle.
//
// The real validateTokenVersion queries prisma.user.findUnique to compare the
// token's tokenVersion claim against the DB value. We mock prisma, so we
// control both sides: sign the JWT with tokenVersion N, and mock findUnique
// to return { tokenVersion: N }.

describe("POST /auth/refresh — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
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
      headers: {
        cookie: "refresh_token=some-token",
      },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 401 when no refresh_token cookie is present", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Missing refresh token");
  });

  it("accepts refresh token from cookie and sets new cookies", async () => {
    const { prisma } = await import("../shared/prisma.js");
    const TOKEN_VERSION = 42; // Use a distinctive value to catch version mismatches

    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-1",
      token: "valid-cookie-token",
      userId: "user-1",
      userAgent: "TestAgent",
      ipAddress: "127.0.0.1",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-1", tokenVersion: TOKEN_VERSION, isAdmin: false, isActive: true },
    } as never);
    // CQ-2: rotateRefreshToken now uses updateMany (conditional on revokedAt: null) + create
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({
      id: "rt-2",
      token: "new-token-value",
      userId: "user-1",
      userAgent: "TestAgent",
      ipAddress: "127.0.0.1",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    } as never);

    // ── Item 6: prisma.user.findUnique must return the correct tokenVersion ───
    // validateTokenVersion (the real implementation) calls this to check the
    // version in the newly issued access token. The token includes TOKEN_VERSION,
    // and the DB mock must agree, or jwtVerify() on subsequent requests will fail.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      tokenVersion: TOKEN_VERSION,
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: "refresh_token=valid-cookie-token",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("Token refreshed");

    // Should set the access token cookie
    const cookies = res.cookies;
    const tokenCookie = cookies.find((c: { name: string }) => c.name === "token");
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.httpOnly).toBe(true);

    // Should also set the refresh_token cookie with rotated value
    const refreshCookie = cookies.find((c: { name: string }) => c.name === "refresh_token");
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe("/api/auth/refresh");

    // ── Item 6 verification: decode the new access token and check tokenVersion ─
    // The issued token must carry the correct tokenVersion so that subsequent
    // jwtVerify() calls can validate it against the DB.
    //
    // The token cookie is signed (signed: true), so its raw value is in the format
    // "s:<JWT>.<HMAC_SIG>". We must unsign it before decoding with app.jwt.decode().
    const signedTokenValue = tokenCookie?.value;
    expect(signedTokenValue).toBeDefined();
    const unsigned = app.unsignCookie(signedTokenValue!);
    expect(unsigned.valid).toBe(true);
    const issuedToken = unsigned.value;
    const decoded = app.jwt.decode(issuedToken!) as {
      userId: string;
      isAdmin: boolean;
      tokenVersion: number;
    };
    expect(decoded.userId).toBe("user-1");
    expect(decoded.tokenVersion).toBe(TOKEN_VERSION);
  });

  it("returns 401 for invalid refresh token", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: "refresh_token=nonexistent-token",
      },
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
      headers: {
        cookie: "refresh_token=replayed-token",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Refresh token reuse");
  });

  it("returns 401 on rotation race condition (CQ-2)", async () => {
    const { prisma } = await import("../shared/prisma.js");
    // Token appears valid on lookup...
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
      id: "rt-race",
      token: "race-token",
      userId: "user-1",
      userAgent: "Agent",
      ipAddress: "1.2.3.4",
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: true },
    } as never);
    // ...but conditional updateMany returns 0 (another request already rotated it)
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: "refresh_token=race-token",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Refresh token reuse");
  });
});
