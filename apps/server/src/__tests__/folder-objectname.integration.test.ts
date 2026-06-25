/**
 * folder-objectname.integration.test.ts
 *
 * Integration tests (app.inject()) for A2-06 / A3-06: the folder register/check
 * routes must reject an objectName that does not live under the requesting user's
 * own namespace, closing the cross-tenant DeleteObject primitive.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(1) },
    folder: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "folder-1",
        name: "Docs",
        description: null,
        objectName: "user-fold/Docs",
        parentId: null,
        userId: "user-fold",
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { files: 0, children: 0 },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    file: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

describe("Folder objectName namespace validation (A2-06 / A3-06)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { folderRoutes } = await import("../modules/folder/routes.js");
    app.register(folderRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => vi.clearAllMocks());

  function signToken(userId: string): string {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function post(url: string, userId: string, objectName: string) {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    return app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/json",
        cookie: `token=${signToken(userId)}; _csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify({ name: "Docs", objectName }),
    });
  }

  it("rejects a folder register whose objectName targets another user's namespace", async () => {
    const res = await post("/folders", "user-fold", "victim-user/secret.pdf");
    expect(res.statusCode).toBe(400);
  });

  it("rejects a folder register whose objectName contains path traversal", async () => {
    const res = await post("/folders", "user-fold", "user-fold/../victim/secret.pdf");
    expect(res.statusCode).toBe(400);
  });

  it("rejects on /folders/check too (same namespace gate)", async () => {
    const res = await post("/folders/check", "user-fold", "victim-user/secret.pdf");
    expect(res.statusCode).toBe(400);
  });

  it("accepts a folder register whose objectName is under the user's own namespace", async () => {
    const res = await post("/folders", "user-fold", "user-fold/Docs");
    // Not blocked by the namespace gate (400) or CSRF (403).
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(403);
  });
});
