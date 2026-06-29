/**
 * setup-bypass-register.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for the A2-03 setup-bypass
 * window on `POST /auth/register` — the ONLY route allowed to run without an
 * admin JWT, and only while zero users exist.
 *
 * This complements `admin-prevalidation.integration.test.ts` (which proves the
 * `allowSetupBypass: false` routes stay locked at zero users). Here we prove the
 * two sides of the bypass on the register route itself:
 *   1. Zero users  → unauthenticated registration SUCCEEDS (legitimate initial
 *      setup is NOT blocked) and the first user is created as an admin.
 *   2. Users exist → unauthenticated registration is REJECTED (401); only an
 *      admin JWT may create further users.
 *   3. Users exist + valid admin JWT → registration SUCCEEDS (admin user
 *      management still works).
 *
 * `/auth/register` is NOT CSRF-exempt, so every request first obtains a
 * double-submit CSRF token via the unauthenticated `GET /csrf-token` endpoint —
 * exactly what the setup wizard does in the browser.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable user count consulted by createAdminPreValidation (setup-bypass check)
// and by UserService.register (isFirstUser decision). Flip per test.
let userCount = 0;

// Captures the row passed to createUser so we can assert isAdmin wiring.
let createdUser: Record<string, unknown> | null = null;

const TOKEN_VERSION = 0;

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn(async () => userCount),
      // Used by validateTokenVersion (wired into jwtVerify) on the admin path.
      findUnique: vi.fn(async () => ({ id: "admin-1", tokenVersion: TOKEN_VERSION })),
    },
    appConfig: {
      // First-user registration flips firstUserAccess server-side.
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) => {
    if (key === "passwordMinLength") return "12";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

// createRefreshToken is the only DB-touching dependency of signAndSetCookies
// (auto-login of the first user). Stub it to a fixed token string.
vi.mock("../modules/auth/refresh-token.service.js", () => ({
  createRefreshToken: vi.fn().mockResolvedValue("test-refresh-token"),
}));

// Token-version validation runs for real shape but always passes for the admin
// path; the unauthenticated paths never reach it (no token → jwtVerify throws).
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  invalidateTokenVersionCache: vi.fn(),
}));

// Row-level user repository: no existing email/username, createUser echoes a
// complete UserResponseSchema-shaped row (the service calls .parse on it).
vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmail = vi.fn().mockResolvedValue(null);
    findUserByUsername = vi.fn().mockResolvedValue(null);
    findUserByEmailOrUsername = vi.fn().mockResolvedValue(null);
    createUser = vi.fn(async (data: Record<string, unknown>) => {
      const now = new Date();
      createdUser = {
        id: "new-user-1",
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        email: data.email,
        image: null,
        isAdmin: data.isAdmin,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        groupId: null,
        groupName: null,
        tokenVersion: TOKEN_VERSION,
        maxFileSizeOverride: null,
        maxTotalStorageOverride: null,
        // Captured so tests can assert the email-language seed forwarded from the
        // request locale. UserResponseSchema.parse() strips this from the response.
        locale: data.locale,
      };
      return createdUser;
    });
  },
}));

const STRONG_PASSWORD = "SetupPass123!"; // 13 chars, 4 classes, < 72 bytes

const REGISTER_BODY = {
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada",
  email: "ada@example.com",
  password: STRONG_PASSWORD,
};

describe("A2-03 setup-bypass — POST /auth/register", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("ENCRYPTION_SECRET", "test-encryption-secret-3333333333-32+chars");
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
    userCount = 0;
    createdUser = null;
  });

  /** Obtain a double-submit CSRF token + cookie via the unauthenticated endpoint. */
  async function csrf(): Promise<{ header: string; cookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    return { header: token, cookie: `_csrf=${csrfCookie?.value}` };
  }

  it("ALLOWS unauthenticated registration when zero users exist (initial setup not blocked)", async () => {
    userCount = 0;
    const { header, cookie } = await csrf();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie, "x-csrf-token": header },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("ada@example.com");
    // First user is provisioned as an admin…
    expect(body.user.isAdmin).toBe(true);
    expect(createdUser?.isAdmin).toBe(true);
    // …and auto-logged-in: an auth cookie is set on the response.
    const authCookie = res.cookies.find((c: { name: string }) => c.name === "token");
    expect(authCookie?.value).toBeTruthy();
  });

  it("REJECTS unauthenticated registration once a user already exists (window closed)", async () => {
    userCount = 1;
    const { header, cookie } = await csrf();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie, "x-csrf-token": header },
      payload: { ...REGISTER_BODY, email: "mallory@example.com", username: "mallory" },
    });

    // No admin JWT → the setup window is closed → 401, and no user is created.
    expect(res.statusCode).toBe(401);
    expect(typeof res.json().error).toBe("string");
    expect(createdUser).toBeNull();
  });

  it("ALLOWS an authenticated admin to register a user after setup (admin management still works)", async () => {
    userCount = 1;
    const { header, cookie } = await csrf();

    const adminJwt = app.jwt.sign({
      userId: "admin-1",
      isAdmin: true,
      tokenVersion: TOKEN_VERSION,
    });
    const adminCookie = `${cookie}; token=${app.signCookie(adminJwt)}`;

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie: adminCookie, "x-csrf-token": header },
      payload: { ...REGISTER_BODY, email: "grace@example.com", username: "grace" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("grace@example.com");
    // Not the first user → created as a non-admin by default.
    expect(body.user.isAdmin).toBe(false);
    expect(createdUser?.isAdmin).toBe(false);
  });

  // ── Email-language seeding from the request locale ──────────────────────────

  it("seeds the new user's locale from the NEXT_LOCALE cookie", async () => {
    userCount = 0;
    const { header, cookie } = await csrf();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie: `${cookie}; NEXT_LOCALE=fr-FR`, "x-csrf-token": header },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(201);
    expect(createdUser?.locale).toBe("fr-FR");
  });

  it("seeds locale from Accept-Language (base-language match) when no cookie is set", async () => {
    userCount = 0;
    const { header, cookie } = await csrf();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie, "x-csrf-token": header, "accept-language": "fr-CA,fr;q=0.9" },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(201);
    // fr-CA isn't a shipped UI locale, but resolves to fr-FR by base language.
    expect(createdUser?.locale).toBe("fr-FR");
  });

  it("leaves locale unset when the request carries no usable locale signal", async () => {
    userCount = 0;
    const { header, cookie } = await csrf();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { cookie, "x-csrf-token": header, "accept-language": "xx-XX" },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(201);
    // No signal → undefined so Prisma applies the column default ("en").
    expect(createdUser?.locale).toBeUndefined();
  });
});
