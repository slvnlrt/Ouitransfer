/**
 * user-locale.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for `PATCH /users/me/locale` —
 * the self-service endpoint that persists the caller's preferred language so it
 * becomes the email language for messages they receive AND the best-available
 * language for invitations they send to external recipients.
 *
 * Guards:
 *   1. an authenticated user can persist a supported locale (200 + DB write),
 *   2. an unsupported / malformed locale is rejected by the Zod body schema (400)
 *      and never reaches the database, and
 *   3. the route is JWT-gated (401 when unauthenticated).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserUpdate = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      update: mockUserUpdate,
      // Consulted by validateTokenVersion wiring on the authenticated path.
      findUnique: mockUserFindUnique,
    },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async () => "true"),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  invalidateTokenVersionCache: vi.fn(),
}));

describe("PATCH /users/me/locale — integration", () => {
  let app: FastifyInstance;

  async function authHeaders(userId = "user-1"): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: TOKEN_VERSION });
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: "user-1", tokenVersion: TOKEN_VERSION });
  });

  it("persists a supported locale and echoes it back", async () => {
    mockUserUpdate.mockResolvedValue({ locale: "fr-FR" });

    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/locale",
      headers: await authHeaders(),
      payload: { locale: "fr-FR" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locale: "fr-FR" });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUserUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "user-1" });
    expect(updateArg.data.locale).toBe("fr-FR");
  });

  it("rejects an unsupported locale with 400 and never writes to the DB", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/locale",
      headers: await authHeaders(),
      payload: { locale: "xx-XX" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a base-language-only code (must be a full UI locale)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/locale",
      headers: await authHeaders(),
      payload: { locale: "fr" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("requires authentication (401 without a JWT)", async () => {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/locale",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: { locale: "fr-FR" },
    });

    expect(res.statusCode).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
