/**
 * auth-providers.integration.test.ts
 *
 * Smoke-test integration tests for the auth-providers module using app.inject().
 * Exercises the full Fastify request lifecycle so schema serialization, auth
 * middleware, and CSRF enforcement are all covered.
 *
 * Routes under test: GET /auth/providers/all (admin-only)
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

// ── Prisma mock ──────────────────────────────────────────────────────────────
// Paths are relative to THIS file (src/__tests__/), so ../shared/prisma.js.
// authProvider.findMany  — called by AuthProvidersService.getAllProviders()
// user.findUnique        — called by validateTokenVersion on each auth'd request
// user.count             — called by admin preValidation setup-bypass check
const mockAuthProviderFindMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserCount = vi.fn().mockResolvedValue(2); // ≥1 user → no setup bypass

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    authProvider: {
      findMany: mockAuthProviderFindMany,
    },
    user: {
      findUnique: mockUserFindUnique,
      count: mockUserCount,
    },
  },
}));

// ── Config service mock ──────────────────────────────────────────────────────
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

// ── Token-version mock ───────────────────────────────────────────────────────
// The real validateTokenVersion does a DB look-up; mock it to accept all tokens
// in tests so JWT verification succeeds without a real DB.
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a sample authProvider row as Prisma would return it. */
function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "prov-1",
    name: "google",
    displayName: "Google",
    type: "oidc",
    icon: null,
    enabled: true,
    autoRegister: true,
    scope: "openid profile email",
    adminEmailDomains: null,
    clientId: "google-client-id",
    issuerUrl: "https://accounts.google.com",
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    sortOrder: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("GET /auth/providers/all — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { authProvidersRoutes } = await import("../modules/auth-providers/routes.js");
    app.register(authProvidersRoutes, { prefix: "/auth" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(2);
    mockUserFindUnique.mockResolvedValue({
      id: "admin-user",
      tokenVersion: TOKEN_VERSION,
    });
    // Default: one provider in DB
    mockAuthProviderFindMany.mockResolvedValue([makeProvider()]);
  });

  // ── Auth guards ───────────────────────────────────────────────────────────

  it("returns 401 when no auth cookie is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    const jwt = app.jwt.sign({
      userId: "non-admin-user",
      isAdmin: false,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
      headers: { cookie: `token=${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 with a data array for an admin user", async () => {
    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: unknown[] }>();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("each item in data has isOfficial boolean and nullable clientId", async () => {
    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    // Two providers: one official (google) and one custom (no clientId)
    mockAuthProviderFindMany.mockResolvedValue([
      makeProvider({ name: "google", clientId: "google-client-id" }),
      makeProvider({
        id: "prov-2",
        name: "my-custom-provider",
        displayName: "My Custom OIDC",
        clientId: null,
        sortOrder: 1,
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      success: boolean;
      data: Array<{ isOfficial: boolean; clientId: string | null }>;
    }>();

    expect(body.data).toHaveLength(2);
    const [official, custom] = body.data;

    // google is an official provider
    expect(typeof official.isOfficial).toBe("boolean");
    expect(official.isOfficial).toBe(true);
    expect(official.clientId).toBe("google-client-id");

    // custom provider: isOfficial = false, clientId = null
    expect(custom.isOfficial).toBe(false);
    expect(custom.clientId).toBeNull();
  });

  it("returns an empty data array when no providers are configured", async () => {
    mockAuthProviderFindMany.mockResolvedValue([]);

    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: unknown[] }>();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("response shape includes all expected fields per provider", async () => {
    const jwt = app.jwt.sign({
      userId: "admin-user",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const token = app.signCookie(jwt);

    const res = await app.inject({
      method: "GET",
      url: "/auth/providers/all",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: Array<Record<string, unknown>>;
    }>();

    const provider = body.data[0];
    // Fields declared in AuthProviderResponseSchema
    expect(provider).toHaveProperty("id");
    expect(provider).toHaveProperty("name");
    expect(provider).toHaveProperty("displayName");
    expect(provider).toHaveProperty("type");
    expect(provider).toHaveProperty("enabled");
    expect(provider).toHaveProperty("autoRegister");
    expect(provider).toHaveProperty("clientId");
    expect(provider).toHaveProperty("isOfficial");
    expect(provider).toHaveProperty("sortOrder");
    // clientSecret must NOT be present (SAFE_PROVIDER_SELECT excludes it)
    expect(provider).not.toHaveProperty("clientSecret");
  });
});
