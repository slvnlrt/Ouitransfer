import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserCount = vi.fn().mockResolvedValue(2);
const mockUserFindUnique = vi.fn();
const mockFileCount = vi.fn().mockResolvedValue(0);
const mockShareCount = vi.fn().mockResolvedValue(0);
const mockReverseShareCount = vi.fn().mockResolvedValue(0);

// ── Mock Prisma ──────────────────────────────────────────────────────────────
// prisma.user.findUnique is used by validateTokenVersion (real implementation)
// to verify tokenVersion claim in JWT matches DB value.
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
    },
    file: {
      count: mockFileCount,
    },
    share: {
      count: mockShareCount,
    },
    reverseShare: {
      count: mockReverseShareCount,
    },
  },
}));

describe("GET /admin/stats — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { adminRoutes } = await import("../modules/admin/routes.js");
    app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: 2 users exist so admin validation runs (no setup-bypass)
    mockUserCount.mockResolvedValue(2);
    // Default: DB returns matching tokenVersion for JWT verification
    mockUserFindUnique.mockResolvedValue({ id: "admin-user", tokenVersion: TOKEN_VERSION });
    // Default: all counts return 0
    mockFileCount.mockResolvedValue(0);
    mockShareCount.mockResolvedValue(0);
    mockReverseShareCount.mockResolvedValue(0);
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("returns 401 even when 0 users exist (no setup bypass)", async () => {
    // allowSetupBypass: false — setup window does NOT apply to admin/stats
    mockUserCount.mockResolvedValue(0);

    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when a non-admin user requests stats", async () => {
    const jwt = app.jwt.sign({
      userId: "non-admin-user",
      isAdmin: false,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    mockUserFindUnique.mockResolvedValueOnce({
      id: "non-admin-user",
      tokenVersion: TOKEN_VERSION,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: {
        cookie: `token=${token}`,
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("administrators");
  });

  it("returns 200 with the expected stats shape for an admin user", async () => {
    // mockUserCount is called twice by the service: total and active.
    // We sequence: first call → total=5, second call → active=3.
    // Note: the admin preValidation also calls user.count (for setup-bypass check),
    // but that hook uses allowSetupBypass: false so it does NOT call user.count.
    // Only the service calls count twice.
    mockUserCount
      .mockResolvedValueOnce(5) // users.total
      .mockResolvedValueOnce(3); // users.active
    mockFileCount.mockResolvedValue(10);
    // share.count is called twice: active, then expired
    mockShareCount
      .mockResolvedValueOnce(7) // shares.active
      .mockResolvedValueOnce(2); // shares.expired
    mockReverseShareCount.mockResolvedValue(4); // reverseShares.active

    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: {
        cookie: `token=${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toMatchObject({
      users: { total: 5, active: 3 },
      files: { total: 10 },
      shares: { active: 7, expired: 2 },
      reverseShares: { active: 4 },
    });
  });

  it("returns 401 when token has a stale tokenVersion (revoked session)", async () => {
    const STALE_VERSION = 99;
    const CURRENT_VERSION = 100;

    const staleJwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: STALE_VERSION,
    });
    const staleToken = app.signCookie(staleJwt);

    mockUserFindUnique.mockResolvedValueOnce({
      id: "admin-user",
      tokenVersion: CURRENT_VERSION,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: {
        cookie: `token=${staleToken}`,
      },
    });

    // The real validateTokenVersion detects the mismatch → jwtVerify throws → 401
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(typeof body.error).toBe("string");
  });
});
