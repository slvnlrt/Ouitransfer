/**
 * Integration tests for server-side alias validation.
 *
 * Both POST /shares/:shareId/alias and POST /reverse-shares/:reverseShareId/alias
 * validate the alias against the shared aliasSchema (min 8, max 30, alphanumeric
 * with single internal hyphens). Invalid aliases are rejected at the route schema
 * with 400 before the handler runs; valid aliases pass validation and reach the
 * handler (which here returns 404 because the mocked share does not exist).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserFindUnique = vi.fn();
const mockShareFindUnique = vi.fn();
const mockReverseShareFindUnique = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, count: vi.fn().mockResolvedValue(1) },
    share: { findUnique: mockShareFindUnique },
    reverseShare: { findUnique: mockReverseShareFindUnique },
    shareAlias: { findUnique: vi.fn(), upsert: vi.fn() },
    reverseShareAlias: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

const INVALID_ALIASES = [
  "abcd", // too short (< 8)
  "abcdefg", // too short (7, just under the 8-char minimum)
  "a".repeat(31), // too long (> 30)
  "-abcde", // leading hyphen
  "abcde-", // trailing hyphen
  "ab--cde", // consecutive hyphens
  "ab_cde", // underscore (rejected after charset unification)
  "ab cde", // space
];

describe("alias validation (integration)", () => {
  let app: FastifyInstance;

  async function userHeaders(): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    const jwt = app.jwt.sign({ userId: "user-1", isAdmin: false, tokenVersion: TOKEN_VERSION });
    return {
      "content-type": "application/json",
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie.value}`,
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

    const { shareRoutes } = await import("../modules/share/routes.js");
    const { reverseShareRoutes } = await import("../modules/reverse-share/routes.js");
    app.register(shareRoutes);
    app.register(reverseShareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: "user-1", tokenVersion: TOKEN_VERSION });
    // Share/reverse-share do not exist → handler throws NotFoundError (404).
    mockShareFindUnique.mockResolvedValue(null);
    mockReverseShareFindUnique.mockResolvedValue(null);
  });

  describe("POST /shares/:shareId/alias", () => {
    it.each(INVALID_ALIASES)("rejects %j with 400", async (alias) => {
      const res = await app.inject({
        method: "POST",
        url: "/shares/share-1/alias",
        headers: await userHeaders(),
        payload: { alias },
      });
      expect(res.statusCode).toBe(400);
      // Validation runs before the handler — the share lookup never happens.
      expect(mockShareFindUnique).not.toHaveBeenCalled();
    });

    it.each([
      "abcdefgh",
      "my-share",
      "Xy7Kp2Qr9Z",
    ])("accepts %j (passes validation, 404 from handler)", async (alias) => {
      const res = await app.inject({
        method: "POST",
        url: "/shares/share-1/alias",
        headers: await userHeaders(),
        payload: { alias },
      });
      expect(res.statusCode).toBe(404);
      expect(mockShareFindUnique).toHaveBeenCalled();
    });
  });

  describe("POST /reverse-shares/:reverseShareId/alias", () => {
    it.each(INVALID_ALIASES)("rejects %j with 400", async (alias) => {
      const res = await app.inject({
        method: "POST",
        url: "/reverse-shares/rs-1/alias",
        headers: await userHeaders(),
        payload: { alias },
      });
      expect(res.statusCode).toBe(400);
      expect(mockReverseShareFindUnique).not.toHaveBeenCalled();
    });

    it.each([
      "abcdefgh",
      "my-drops",
      "Xy7Kp2Qr9Z",
    ])("accepts %j (passes validation, 404 from handler)", async (alias) => {
      const res = await app.inject({
        method: "POST",
        url: "/reverse-shares/rs-1/alias",
        headers: await userHeaders(),
        payload: { alias },
      });
      expect(res.statusCode).toBe(404);
      expect(mockReverseShareFindUnique).toHaveBeenCalled();
    });
  });
});
