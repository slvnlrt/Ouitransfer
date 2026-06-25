/**
 * user-admin-protection.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for:
 *   - A2-02: last-admin / self-lockout protection on demote / deactivate / delete.
 *   - A2-03: the zero-user setup bypass no longer applies to the user-management
 *     routes (`GET /users`, `PUT /users`, etc.) — only first-user registration.
 *
 * prisma is mocked at the row level; the UserService guard logic runs for real.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserCount = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockUserDeactivate = vi.fn();
const mockAuditCreate = vi.fn();

// Default admin target row (the user being acted upon).
function adminTargetRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "target-admin",
    firstName: "T",
    lastName: "A",
    username: "targetadmin",
    email: "target@example.com",
    image: null,
    isAdmin: true,
    isActive: true,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
    groupId: null,
    group: null,
    maxFileSizeOverride: null,
    maxTotalStorageOverride: null,
    ...overrides,
  };
}

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
    auditLog: { create: mockAuditCreate },
    appConfig: { findUnique: vi.fn().mockResolvedValue({ value: "12" }) },
  },
}));

// UserService.deactivateUser/updateUser go through the repository for the actual
// write — mock the repository so only the guard (which uses prisma directly) runs
// against our controlled rows.
vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserById = mockUserFindUnique;
    deactivateUser = mockUserDeactivate;
    updateUser = mockUserUpdate;
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) => {
    if (key === "passwordMinLength") return "12";
    return "true";
  }),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  invalidateTokenVersionCache: vi.fn(),
  validateTokenVersion: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/refresh-token.service.js", () => ({
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("user admin-protection — integration (A2-02 / A2-03)", () => {
  let app: FastifyInstance;

  async function adminHeaders(userId = "actor-admin"): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    const jwt = app.jwt.sign({ userId, isAdmin: true, tokenVersion: TOKEN_VERSION });
    return {
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie?.value}`,
      "x-csrf-token": csrfToken,
    };
  }

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { userRoutes } = await import("../modules/user/routes.js");
    app.register(userRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  // Controls what findUserById returns for the TARGET user id. Keyed by id so the
  // test does not depend on call ordering (validateTokenVersion is mocked and may
  // or may not hit the DB).
  let targetRows: Record<string, Record<string, unknown> | null> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(2);
    mockAuditCreate.mockResolvedValue({});
    targetRows = {};
    // This single mock backs BOTH prisma.user.findUnique({ where: { id } }) and
    // the repository's findUserById(id: string), so accept either calling form.
    mockUserFindUnique.mockImplementation(async (arg: string | { where?: { id?: string } }) => {
      const id = typeof arg === "string" ? arg : arg?.where?.id;
      if (id && id in targetRows) return targetRows[id];
      // Default: a generic row (covers token-version + audit reads).
      return id ? { id, tokenVersion: TOKEN_VERSION } : null;
    });
  });

  // ── A2-02 ───────────────────────────────────────────────────────────────────
  describe("A2-02 — last-admin / self-lockout protection", () => {
    it("refuses to deactivate the LAST active admin (409 LAST_ADMIN)", async () => {
      targetRows["target-admin"] = adminTargetRow();
      mockUserCount.mockResolvedValue(0); // no OTHER active admins remain

      const res = await app.inject({
        method: "PATCH",
        url: "/users/target-admin/deactivate",
        headers: await adminHeaders(),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("LAST_ADMIN");
      expect(mockUserDeactivate).not.toHaveBeenCalled();
    });

    it("allows deactivating an admin when ANOTHER active admin remains", async () => {
      targetRows["target-admin"] = adminTargetRow();
      mockUserCount.mockResolvedValue(1); // one other admin remains
      mockUserDeactivate.mockResolvedValue(adminTargetRow({ isActive: false }));

      const res = await app.inject({
        method: "PATCH",
        url: "/users/target-admin/deactivate",
        headers: await adminHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(mockUserDeactivate).toHaveBeenCalledWith("target-admin");
    });

    it("blocks an admin from deactivating their OWN account (self-lockout)", async () => {
      targetRows["actor-admin"] = adminTargetRow({ id: "actor-admin" });
      mockUserCount.mockResolvedValue(5); // other admins exist — self-action still blocked

      const res = await app.inject({
        method: "PATCH",
        url: "/users/actor-admin/deactivate",
        headers: await adminHeaders("actor-admin"),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("LAST_ADMIN");
      expect(mockUserDeactivate).not.toHaveBeenCalled();
    });

    it("refuses to DEMOTE the last admin via PUT /users (409 LAST_ADMIN)", async () => {
      targetRows["target-admin"] = adminTargetRow();
      mockUserCount.mockResolvedValue(0); // no OTHER active admins

      const res = await app.inject({
        method: "PUT",
        url: "/users",
        headers: await adminHeaders(),
        payload: { id: "target-admin", isAdmin: false },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("LAST_ADMIN");
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });

  // ── A2-03 ───────────────────────────────────────────────────────────────────
  describe("A2-03 — no setup bypass on user-management routes", () => {
    it("GET /users is 401 in the zero-user window (no setup bypass)", async () => {
      mockUserCount.mockResolvedValue(0); // zero users — old behaviour would bypass auth

      const res = await app.inject({ method: "GET", url: "/users" });

      expect(res.statusCode).toBe(401);
    });

    it("PUT /users is rejected (401/403) in the zero-user window", async () => {
      mockUserCount.mockResolvedValue(0);

      // No auth cookie at all → CSRF or auth rejects; must NOT reach the handler.
      const res = await app.inject({
        method: "PUT",
        url: "/users",
        payload: { id: "x", isAdmin: true },
      });

      expect([401, 403]).toContain(res.statusCode);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });
});
