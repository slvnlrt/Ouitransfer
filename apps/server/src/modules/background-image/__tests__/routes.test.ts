/**
 * routes.test.ts
 *
 * Integration tests for background-image routes using app.inject().
 *
 * Tests the full request lifecycle for:
 * - GET  /background-images          — public list
 * - GET  /background-images/:id/image — public image redirect
 * - POST /background-images          — admin upload (auth gate)
 * - PATCH /background-images/order   — admin reorder (auth gate)
 * - PATCH /background-images/:id     — admin rename (auth gate)
 * - DELETE /background-images/:id    — admin delete (auth gate)
 *
 * Mock path notes: all vi.mock() specifiers are resolved relative to the
 * CALLING TEST FILE (src/modules/background-image/__tests__/routes.test.ts),
 * not the project root.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
// admin-prevalidation.ts calls prisma.user.count to check setup-bypass.
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(),
    },
    backgroundImage: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

// ── Mock config service ───────────────────────────────────────────────────────
vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "passwordMinLength") return "8";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock token version — always trusts tokens in this suite ──────────────────
vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock BackgroundImageService — avoid S3/sharp dependency in route tests ───
vi.mock("../service.js", () => ({
  BackgroundImageService: class MockBackgroundImageService {
    listAll = vi.fn().mockResolvedValue([]);
    getImageUrl = vi.fn().mockResolvedValue("https://s3.example.com/presigned-url");
    upload = vi.fn().mockResolvedValue({
      id: "img-1",
      name: "Test Image",
      thumbnailUrl: "https://s3.example.com/thumb",
      fullUrl: "https://s3.example.com/full",
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    rename = vi.fn().mockResolvedValue({
      id: "img-1",
      name: "Renamed Image",
      thumbnailUrl: "https://s3.example.com/thumb",
      fullUrl: "https://s3.example.com/full",
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    reorder = vi.fn().mockResolvedValue(undefined);
    delete = vi.fn().mockResolvedValue(undefined);
  },
}));

// ── Static import of mocked prisma (must come AFTER vi.mock hoisting) ─────────
import { prisma } from "../../../shared/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────

describe("Background image routes — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const { backgroundImageRoutes } = await import("../routes.js");
    app.register(backgroundImageRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish defaults after clearAllMocks
    vi.mocked(prisma.user.count).mockResolvedValue(1);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signAdminToken(): string {
    const jwt = app.jwt.sign({ userId: "admin-user", isAdmin: true, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  function signUserToken(): string {
    const jwt = app.jwt.sign({ userId: "regular-user", isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /background-images — public list
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /background-images", () => {
    it("returns 200 with empty images array when no images exist", async () => {
      const res = await app.inject({ method: "GET", url: "/background-images" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("images");
      expect(Array.isArray(body.images)).toBe(true);
      expect(body.images).toHaveLength(0);
    });

    it("returns 200 without auth (public endpoint)", async () => {
      const res = await app.inject({ method: "GET", url: "/background-images" });
      expect(res.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /background-images/:id/image — public redirect
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /background-images/:id/image", () => {
    it("returns 302 redirect for an existing image", async () => {
      // The mock service.getImageUrl resolves with a URL → routes replies with redirect
      const res = await app.inject({
        method: "GET",
        url: "/background-images/img-1/image",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("https://s3.example.com/presigned-url");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /background-images — admin upload
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /background-images", () => {
    it("returns 401 without auth cookie (GET /csrf-token-exempt, POST needs auth first)", async () => {
      // No auth and no CSRF: admin preValidation fires first → 401
      // CSRF hook also fires for POST; either 401 or 403 is acceptable
      const res = await app.inject({
        method: "POST",
        url: "/background-images",
      });

      expect([401, 403]).toContain(res.statusCode);
      const body = res.json();
      expect(typeof body.error).toBe("string");
    });

    it("returns 403 for non-admin user", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "POST",
        url: "/background-images",
        headers: {
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(typeof body.error).toBe("string");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH /background-images/order — admin reorder
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PATCH /background-images/order", () => {
    it("returns 401 or 403 without auth cookie", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/background-images/order",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ ids: ["img-1", "img-2"] }),
      });

      expect([401, 403]).toContain(res.statusCode);
      const body = res.json();
      expect(typeof body.error).toBe("string");
    });

    it("returns 200 with success:true for valid admin request", async () => {
      const token = signAdminToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PATCH",
        url: "/background-images/order",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({ ids: ["img-1", "img-2"] }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH /background-images/:id — admin rename
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PATCH /background-images/:id", () => {
    it("returns 401 or 403 without auth cookie", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/background-images/img-1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "New Name" }),
      });

      expect([401, 403]).toContain(res.statusCode);
    });

    it("returns 200 with updated image for valid admin rename", async () => {
      const token = signAdminToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PATCH",
        url: "/background-images/img-1",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({ name: "Renamed Image" }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("image");
      expect(body.image.name).toBe("Renamed Image");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE /background-images/:id — admin delete
  // ═══════════════════════════════════════════════════════════════════════════

  describe("DELETE /background-images/:id", () => {
    it("returns 401 or 403 without auth cookie", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/background-images/img-1",
      });

      expect([401, 403]).toContain(res.statusCode);
      const body = res.json();
      expect(typeof body.error).toBe("string");
    });

    it("returns 200 with success:true for valid admin delete", async () => {
      const token = signAdminToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "DELETE",
        url: "/background-images/img-1",
        headers: {
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it("returns 403 for non-admin user", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "DELETE",
        url: "/background-images/img-1",
        headers: {
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(typeof body.error).toBe("string");
    });
  });
});
