import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockUserCount = vi.fn().mockResolvedValue(2);
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockAuditCount = vi.fn().mockResolvedValue(0);

// Mock Prisma before any imports that use it
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: mockUserCount },
    auditLog: {
      findMany: mockFindMany,
      count: mockAuditCount,
    },
  },
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

describe("GET /admin/audit-logs — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
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
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit-logs",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when a non-admin user requests audit logs", async () => {
    // Sign a JWT for a non-admin user
    const token = app.jwt.sign({
      userId: "non-admin-user",
      isAdmin: false,
      tokenVersion: 0,
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

    const token = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: 0,
    });

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
    const token = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: 0,
    });

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
});
