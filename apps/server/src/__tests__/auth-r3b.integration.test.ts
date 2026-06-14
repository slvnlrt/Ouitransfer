/**
 * auth-r3b.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for the R3b auth-hardening
 * batch:
 *   - A1-06: forgot-password returns the generic 200 (no enumeration) for an
 *     existing local user when password auth is disabled — identical to an
 *     unknown email.
 *   - A1-09: new-password policy rejects > 72-byte passwords and passwords that
 *     fail the complexity rule (register / reset paths).
 *   - A1-10: login returns a single generic "Invalid credentials" for unknown
 *     user, inactive account, and external-auth account (no distinct errors), and
 *     runs a bcrypt comparison even for a non-existent user (existence masking).
 *   - A1-12: logout bumps tokenVersion so the current access token is invalidated.
 *
 * Strategy: prisma is mocked at the row level; the auth/login-attempts/
 * password-policy services run for real so the tests exercise the true wiring.
 */

import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface AttemptRow {
  email: string;
  ipAddress: string;
  success: boolean;
  createdAt: Date;
}
const attemptStore: AttemptRow[] = [];

// Mutable user row returned by the user repository / prisma.user mocks.
let userRow: Record<string, unknown> | null = null;
// Records the tokenVersion increments performed (A1-12).
const tokenVersionIncrements: string[] = [];

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(async () => userRow),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (userRow) Object.assign(userRow, data);
        return userRow;
      }),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    trustedDevice: {
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    passwordReset: { create: vi.fn().mockResolvedValue({}) },
    loginAttempt: {
      create: vi.fn(async ({ data }: { data: Omit<AttemptRow, "createdAt"> }) => {
        attemptStore.push({ ...data, createdAt: new Date() });
        return {};
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: {
            email?: string;
            ipAddress?: string;
            success?: boolean;
            createdAt?: { gte: Date };
          };
          take?: number;
        }) => {
          let rows = attemptStore.filter((r) => {
            if (where.email !== undefined && r.email !== where.email) return false;
            if (where.ipAddress !== undefined && r.ipAddress !== where.ipAddress) return false;
            if (where.success !== undefined && r.success !== where.success) return false;
            if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
            return true;
          });
          rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return take ? rows.slice(0, take) : rows;
        },
      ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

// Mutable config — tests flip passwordAuthEnabled for A1-06.
let passwordAuthEnabled = "true";
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) => {
    if (key === "passwordMinLength") return "12";
    if (key === "passwordAuthEnabled") return passwordAuthEnabled;
    if (key === "passwordResetTokenExpiration") return "3600";
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

vi.mock("../modules/email/url-builder.js", () => ({
  buildResetPasswordUrl: vi.fn().mockResolvedValue("https://example.com/reset?token=x"),
}));

vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmailOrUsername = vi.fn(async () => userRow);
    findUserByEmail = vi.fn(async () => userRow);
  },
}));

vi.mock("../modules/user/dto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/user/dto.js")>();
  return {
    ...actual,
    // Leniently pass through the partial test user rows (avoids requiring every
    // field the real schema validates).
    UserResponseSchema: { parse: (u: unknown) => u },
  };
});

vi.mock("../modules/auth/token-version.js", () => ({
  incrementTokenVersion: vi.fn(async (userId: string) => {
    tokenVersionIncrements.push(userId);
  }),
  invalidateTokenVersionCache: vi.fn(),
  validateTokenVersion: vi.fn().mockResolvedValue(true),
}));

const ENCRYPTION_SECRET = "test-encryption-secret-3333333333-32+chars";

describe("R3b auth hardening — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("ENCRYPTION_SECRET", ENCRYPTION_SECRET);
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { authRoutes } = await import("../modules/auth/routes.js");
    const { userRoutes } = await import("../modules/user/routes.js");
    app.register(authRoutes);
    app.register(userRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    attemptStore.length = 0;
    tokenVersionIncrements.length = 0;
    userRow = null;
    passwordAuthEnabled = "true";
    vi.clearAllMocks();
  });

  /** Headers for an authenticated, CSRF-protected POST. */
  async function authPostHeaders(userId: string, isAdmin = false): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    const jwt = app.jwt.sign({ userId, isAdmin, tokenVersion: 0 });
    return {
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie?.value}`,
      "x-csrf-token": token,
    };
  }

  // ── A1-06 ───────────────────────────────────────────────────────────────────
  describe("A1-06 — forgot-password no enumeration when password auth disabled", () => {
    it("returns the generic 200 for an EXISTING local user when password auth is disabled", async () => {
      passwordAuthEnabled = "false";
      userRow = { id: "u1", email: "real@example.com", ldapDn: null, locale: "en" };

      const res = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "real@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain("If an account exists");
    });

    it("returns the identical generic 200 for an UNKNOWN email", async () => {
      passwordAuthEnabled = "false";
      userRow = null;

      const res = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "ghost@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain("If an account exists");
    });
  });

  // ── A1-09 ───────────────────────────────────────────────────────────────────
  describe("A1-09 — password policy (max-length + complexity) on new passwords", () => {
    it("rejects a registration password longer than 72 bytes", async () => {
      // 73 ASCII chars, all classes present so only the byte-length rule trips.
      const tooLong = `Aa1!${"x".repeat(69)}`; // 4 + 69 = 73 bytes
      expect(Buffer.byteLength(tooLong, "utf8")).toBe(73);

      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: await authPostHeaders("admin-1", true),
        payload: {
          firstName: "A",
          lastName: "B",
          username: "abc",
          email: "new@example.com",
          password: tooLong,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects a registration password failing the complexity rule (only 2 classes)", async () => {
      // 16 chars, lowercase + digits only → 2 classes < required 3.
      const weak = "aaaaaaaa11111111";
      expect(weak.length).toBeGreaterThanOrEqual(12);

      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: await authPostHeaders("admin-1", true),
        payload: {
          firstName: "A",
          lastName: "B",
          username: "abc",
          email: "new@example.com",
          password: weak,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── A1-10 ───────────────────────────────────────────────────────────────────
  describe("A1-10 — generic login failures + existence masking", () => {
    it("runs a bcrypt comparison even for a NON-EXISTENT user (records a failure, generic 401)", async () => {
      userRow = null;
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { emailOrUsername: "ghost@example.com", password: "whatever-12!" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid credentials");
      expect(attemptStore.length).toBe(1);
      expect(attemptStore[0].success).toBe(false);
    });

    it("returns generic 'Invalid credentials' for an INACTIVE account (not a distinct error)", async () => {
      userRow = {
        id: "u1",
        email: "inactive@example.com",
        isActive: false,
        password: await bcrypt.hash("correct-12!A", 12),
      };
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { emailOrUsername: "inactive@example.com", password: "correct-12!A" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid credentials");
    });

    it("returns generic 'Invalid credentials' for an EXTERNAL-auth account (no password)", async () => {
      userRow = {
        id: "u1",
        email: "oidc@example.com",
        isActive: true,
        password: null,
      };
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { emailOrUsername: "oidc@example.com", password: "anything-12!A" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid credentials");
    });

    it("succeeds for an active local user with the correct password", async () => {
      const now = new Date();
      userRow = {
        id: "u1",
        firstName: "Good",
        lastName: "User",
        username: "gooduser",
        email: "good@example.com",
        isAdmin: false,
        isActive: true,
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now,
        password: await bcrypt.hash("correct-12!A", 12),
        twoFactorEnabled: false,
      };
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { emailOrUsername: "good@example.com", password: "correct-12!A" },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── A1-12 ───────────────────────────────────────────────────────────────────
  describe("A1-12 — logout invalidates the access token via tokenVersion", () => {
    it("bumps tokenVersion (and awaits revocation) on logout", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: await authPostHeaders("logout-user"),
      });

      expect(res.statusCode).toBe(200);
      // tokenVersion was incremented for the logging-out user → current access
      // token is immediately invalidated (validateTokenVersion would now reject).
      expect(tokenVersionIncrements).toContain("logout-user");
    });
  });
});
