import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockUserCount = vi.fn().mockResolvedValue(2);
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockAuditCount = vi.fn().mockResolvedValue(0);

// ── Mock Prisma ──────────────────────────────────────────────────────────────
// Item 6: prisma.user.findUnique is included here so that validateTokenVersion
// (the real implementation — NOT mocked) can verify that a token's tokenVersion
// claim matches the DB value. Each test signs a JWT with tokenVersion: 0 and
// this mock returns { tokenVersion: 0 }, so they agree.
const mockUserFindUnique = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
    },
    auditLog: {
      findMany: mockFindMany,
      count: mockAuditCount,
    },
  },
}));

// ── Item 6: Do NOT mock validateTokenVersion ──────────────────────────────────
// The real validateTokenVersion is used so that the token verification path is
// fully exercised. We control both sides of the check:
//   1. app.jwt.sign() issues a token with the tokenVersion we choose.
//   2. mockUserFindUnique returns { tokenVersion: <same value> }.
// If the tokenVersion in the JWT does not match the DB, jwtVerify() will reject
// the token with 401 — exactly what should happen in production.

describe("GET /admin/audit-logs — integration", () => {
  let app: FastifyInstance;

  // Token version used in all test JWTs. Must match what mockUserFindUnique returns.
  const TOKEN_VERSION = 0;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { auditRoutes } = await import("../modules/audit/routes.js");
    app.register(auditRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset user count to 2 (so admin validation kicks in)
    mockUserCount.mockResolvedValue(2);
    mockFindMany.mockResolvedValue([]);
    mockAuditCount.mockResolvedValue(0);

    // Default: user exists with tokenVersion matching the JWTs signed in these tests.
    // validateTokenVersion (real) will call prisma.user.findUnique and compare.
    mockUserFindUnique.mockResolvedValue({ id: "admin-user", tokenVersion: TOKEN_VERSION });
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when a non-admin user requests audit logs", async () => {
    // Sign a JWT for a non-admin user with tokenVersion matching the DB mock
    const jwt = app.jwt.sign({
      userId: "non-admin-user",
      isAdmin: false,
      tokenVersion: TOKEN_VERSION,
    });
    // Cookie is signed (signed: true) — must use app.signCookie() to produce
    // the "s:<value>.<hmac>" format that @fastify/jwt expects to unsign.
    const token = app.signCookie(jwt);

    // The non-admin user also needs a matching DB entry for validateTokenVersion
    mockUserFindUnique.mockResolvedValueOnce({
      id: "non-admin-user",
      tokenVersion: TOKEN_VERSION,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
      headers: {
        cookie: `token=${token}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("administrators");
  });

  it("returns 200 with logs for admin user", async () => {
    const mockLogs = [
      {
        id: "log-1",
        userId: "user-1",
        action: "LOGIN_SUCCESS",
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
        metadata: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    mockFindMany.mockResolvedValue(mockLogs);
    mockAuditCount.mockResolvedValue(1);

    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    // mockUserFindUnique is set in beforeEach to return { tokenVersion: TOKEN_VERSION }
    // for "admin-user" — no extra setup needed here.

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
      headers: {
        cookie: `token=${token}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].action).toBe("LOGIN_SUCCESS");
    expect(body.total).toBe(1);
  });

  it("forwards query params for filtering and pagination", async () => {
    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?action=LOGIN_SUCCESS&limit=10&offset=5",
      headers: {
        cookie: `token=${token}`,
      },
    });
    expect(res.statusCode).toBe(200);

    // Verify the service was called with parsed (coerced) params
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "LOGIN_SUCCESS" },
        take: 10,
        skip: 5,
      }),
    );
  });

  it("returns 401 when there are zero users and no auth token", async () => {
    mockUserCount.mockResolvedValue(0);

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
      // No auth cookie — should be rejected even when user count is 0
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Item 6: token with wrong tokenVersion must be rejected ─────────────────
  // This test would FAIL if validateTokenVersion were mocked to always return true,
  // proving that removing the mock actually tightens the security check.
  it("returns 401 when token has a stale tokenVersion (revoked session)", async () => {
    const STALE_VERSION = 99;
    const CURRENT_VERSION = 100; // DB has been incremented (e.g. password change)

    // Sign a JWT with the old (stale) version
    const staleJwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: STALE_VERSION,
    });
    const staleToken = app.signCookie(staleJwt);

    // DB returns the current (newer) version — token is now invalid
    mockUserFindUnique.mockResolvedValueOnce({
      id: "admin-user",
      tokenVersion: CURRENT_VERSION,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
      headers: {
        cookie: `token=${staleToken}`,
      },
    });
    // The real validateTokenVersion detects the mismatch and returns false,
    // causing jwtVerify() to throw an Untrusted Token error → 401.
    expect(res.statusCode).toBe(401);
  });
});
