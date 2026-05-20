import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeEmailServiceClass,
  makeTestUser,
  makeTrustedDeviceServiceClass,
  mockFindUserByEmailOrUsername,
  mockIsEnabled,
  mockVerifyToken,
  UNLOCKED_STATE,
} from "./fixtures/auth-mocks.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    loginAttempt: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    passwordReset: { findFirst: vi.fn() },
  },
}));

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/login-attempts.service.js", () => ({
  isAccountLocked: vi.fn().mockResolvedValue({ locked: false, remainingMinutes: 0 }),
  recordLoginAttempt: vi.fn(),
}));

vi.mock("../modules/email/service.js", () => ({
  EmailService: makeEmailServiceClass(),
}));

vi.mock("../modules/auth/trusted-device.service.js", () => ({
  TrustedDeviceService: makeTrustedDeviceServiceClass(),
}));

// 2FA service — uses shared mock instances so tests can assert on them.
// isEnabled defaults to true (2FA enabled) for 2FA flow tests.
mockIsEnabled.mockResolvedValue(true);
vi.mock("../modules/two-factor/service.js", () => ({
  TwoFactorService: class {
    isEnabled = mockIsEnabled;
    verifyToken = mockVerifyToken;
  },
}));

// User repository — uses shared mock instance so tests can control results.
vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmailOrUsername = mockFindUserByEmailOrUsername;
    findUserByEmail = vi.fn();
  },
}));

vi.mock("../modules/user/dto.js", () => ({
  UserResponseSchema: {
    parse: vi.fn((user: unknown) => user),
  },
}));

// Mock challenge token — bypass real jose signing
vi.mock("../modules/auth/challenge.js", () => ({
  createChallengeToken: vi.fn().mockResolvedValue("mocked-challenge-token"),
  verifyChallengeToken: vi.fn().mockResolvedValue("user-1"),
}));

describe("POST /api/auth/2fa/login — lockout integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { authRoutes } = await import("../modules/auth/routes.js");
    app.register(authRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks wipes them
    const { verifyChallengeToken } = await import("../modules/auth/challenge.js");
    vi.mocked(verifyChallengeToken).mockResolvedValue("user-1");
    const { isAccountLocked } = await import("../modules/auth/login-attempts.service.js");
    vi.mocked(isAccountLocked).mockResolvedValue(UNLOCKED_STATE);
  });

  const inject2fa = (token = "123456") =>
    app.inject({
      method: "POST",
      url: "/auth/2fa/login",
      payload: {
        challengeToken: "mocked-challenge-token",
        token,
        rememberDevice: false,
      },
    });

  it("returns 403 with ACCOUNT_LOCKED when account is locked during 2FA", async () => {
    const { isAccountLocked } = await import("../modules/auth/login-attempts.service.js");
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: true, remainingMinutes: 8 });

    // Need a user in the DB for the service to find
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeTestUser() as never);

    const res = await inject2fa();

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(body.error).toContain("locked");
    expect(body.details).toEqual({ remainingMinutes: 8 });
  });

  it("audits LOGIN_LOCKED on lockout during 2FA", async () => {
    const { isAccountLocked } = await import("../modules/auth/login-attempts.service.js");
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: true, remainingMinutes: 3 });

    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeTestUser() as never);

    await inject2fa();

    // Verify audit log recorded LOGIN_LOCKED (not LOGIN_FAILURE)
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "LOGIN_LOCKED",
          metadata: expect.stringContaining("2fa"),
        }),
      }),
    );
  });

  it("returns 401 and records failure on invalid 2FA token", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeTestUser() as never);

    // Mock 2FA verification failure
    mockVerifyToken.mockResolvedValue({
      success: false,
      method: "totp" as const,
    });

    const res = await inject2fa("000000");

    expect(res.statusCode).toBe(401);

    // Should record a failed attempt
    const { recordLoginAttempt } = await import("../modules/auth/login-attempts.service.js");
    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith(
      "test@example.com",
      expect.any(String),
      false,
    );

    // Audit log should record LOGIN_FAILURE with 2fa method
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "LOGIN_FAILURE",
          metadata: expect.stringContaining("2fa"),
        }),
      }),
    );
  });

  it("returns 200 and records success on valid 2FA token", async () => {
    const { prisma } = await import("../shared/prisma.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeTestUser() as never);

    // Mock 2FA verification success
    mockVerifyToken.mockResolvedValue({
      success: true,
      method: "totp" as const,
    });

    const res = await inject2fa("123456");

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe("user-1");

    // Should record a successful attempt
    const { recordLoginAttempt } = await import("../modules/auth/login-attempts.service.js");
    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith(
      "test@example.com",
      expect.any(String),
      true,
    );

    // Audit log should record LOGIN_SUCCESS with 2fa method
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "LOGIN_SUCCESS",
          userId: "user-1",
          metadata: expect.stringContaining("2fa"),
        }),
      }),
    );
  });
});
