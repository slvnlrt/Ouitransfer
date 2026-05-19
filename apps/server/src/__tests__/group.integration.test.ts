/**
 * group.integration.test.ts
 *
 * Integration tests for group management using app.inject().
 * Tests the full request lifecycle for group CRUD and member operations.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    group: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    file: {
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { size: 0n }, _count: 0, _avg: {}, _min: {}, _max: {} }),
    },
    reverseShareFile: {
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { size: null }, _count: 0, _avg: {}, _min: {}, _max: {} }),
    },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "maxFileSize") return String(100 * 1024 * 1024);
    if (key === "maxTotalStoragePerUser") return String(1024 * 1024 * 1024);
    if (key === "passwordMinLength") return "8";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Static import of mocked module (must come AFTER vi.mock) ─────────────────
import { prisma } from "../shared/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────

describe("Group management integration tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { groupRoutes } = await import("../modules/group/routes.js");
    app.register(groupRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: 1 user exists (non-setup mode)
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    // Default: file/reverseShareFile aggregates return zero
    vi.mocked(prisma.file.aggregate).mockResolvedValue({
      _sum: { size: 0n },
      _count: 0,
      _avg: {},
      _min: {},
      _max: {},
    } as never);
    vi.mocked(prisma.reverseShareFile.aggregate).mockResolvedValue({
      _sum: { size: null },
      _count: 0,
      _avg: {},
      _min: {},
      _max: {},
    } as never);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signTestToken(userId: string, isAdmin = false): string {
    const jwt = app.jwt.sign({ userId, isAdmin, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  function adminHeaders(csrfToken: string, csrfCookie: string, userId = "admin-1") {
    const token = signTestToken(userId, true);
    return {
      "content-type": "application/json",
      cookie: `token=${token}; _csrf=${csrfCookie}`,
      "x-csrf-token": csrfToken,
    };
  }

  function adminDeleteHeaders(csrfToken: string, csrfCookie: string, userId = "admin-1") {
    const token = signTestToken(userId, true);
    return {
      cookie: `token=${token}; _csrf=${csrfCookie}`,
      "x-csrf-token": csrfToken,
    };
  }

  // ── Tests ───────────────────────────────────────────────────────────────────

  describe("Admin-only enforcement", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const res = await app.inject({ method: "GET", url: "/groups" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin users", async () => {
      const token = signTestToken("user-1", false);
      const res = await app.inject({
        method: "GET",
        url: "/groups",
        headers: { cookie: `token=${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /groups", () => {
    it("creates a group successfully", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.group.create).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        description: null,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        ldapDn: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/groups",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ name: "Engineering" }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("Engineering");
    });

    it("returns 409 on duplicate name", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({ id: "grp-1" } as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/groups",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ name: "Engineering" }),
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe("GET /groups", () => {
    it("returns list of groups with member counts", async () => {
      vi.mocked(prisma.group.findMany).mockResolvedValue([
        {
          id: "grp-1",
          name: "Engineering",
          description: null,
          maxFileSizeOverride: null,
          maxTotalStorageOverride: 21474836480n,
          ldapDn: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { members: 3 },
        },
      ] as never);

      const token = signTestToken("admin-1", true);
      const res = await app.inject({
        method: "GET",
        url: "/groups",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].memberCount).toBe(3);
      expect(body[0].maxTotalStorageOverride).toBe("21474836480");
    });
  });

  describe("DELETE /groups/:id", () => {
    it("deletes group and returns unassigned count", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.count).mockResolvedValue(5);
      vi.mocked(prisma.group.delete).mockResolvedValue({} as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "DELETE",
        url: "/groups/grp-1",
        headers: adminDeleteHeaders(csrfToken, csrfCookie),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.unassignedCount).toBe(5);
    });

    it("returns 404 for non-existent group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue(null);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "DELETE",
        url: "/groups/grp-nope",
        headers: adminDeleteHeaders(csrfToken, csrfCookie),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /groups/:id/members", () => {
    it("adds a member to a group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: null,
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/groups/grp-1/members",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ userId: "user-1" }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.previousGroupId).toBeNull();
    });
  });

  describe("DELETE /groups/:id/members/:userId", () => {
    it("removes a member from a group", async () => {
      vi.mocked(prisma.group.findUnique).mockResolvedValue({
        id: "grp-1",
        name: "Engineering",
        members: [],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        groupId: "grp-1",
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "DELETE",
        url: "/groups/grp-1/members/user-1",
        headers: adminDeleteHeaders(csrfToken, csrfCookie),
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
