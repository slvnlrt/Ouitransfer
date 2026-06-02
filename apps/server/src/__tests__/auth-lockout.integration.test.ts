import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeEmailServiceMock,
  makeTrustedDeviceServiceClass,
  makeTwoFactorServiceClass,
  makeUserRepositoryClass,
} from "./fixtures/auth-mocks.js";

// Mock Prisma before any imports that use it
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

// Mock config used during route registration
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// Mock login-attempts.service — the key mock for this test
vi.mock("../modules/auth/login-attempts.service.js", () => ({
  isAccountLocked: vi.fn().mockResolvedValue({ locked: false, remainingMinutes: 0 }),
  recordLoginAttempt: vi.fn(),
}));

// Mock email service (not exercised in lockout path)
vi.mock("../modules/email/service.js", () => ({
  emailService: makeEmailServiceMock(),
}));

// Mock trusted device service (not exercised in lockout path)
vi.mock("../modules/auth/trusted-device.service.js", () => ({
  TrustedDeviceService: makeTrustedDeviceServiceClass(),
}));

// Mock 2FA service (2FA disabled by default — not exercised in lockout path)
vi.mock("../modules/two-factor/service.js", () => ({
  TwoFactorService: makeTwoFactorServiceClass(false),
}));

// Mock user repository (not reached when locked)
vi.mock("../modules/user/repository.js", () => ({
  PrismaUserRepository: makeUserRepositoryClass(),
}));

// Mock user DTO (not reached when locked)
vi.mock("../modules/user/dto.js", () => ({
  UserResponseSchema: {
    parse: vi.fn((user: unknown) => user),
  },
}));

describe("POST /api/auth/login — account lockout integration", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 with ACCOUNT_LOCKED code and remainingMinutes when account is locked", async () => {
    const { isAccountLocked } = await import("../modules/auth/login-attempts.service.js");
    vi.mocked(isAccountLocked).mockResolvedValue({
      locked: true,
      remainingMinutes: 12,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        emailOrUsername: "locked@example.com",
        password: "any-password",
      },
    });

    expect(res.statusCode).toBe(403);

    const body = res.json();
    expect(body.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(body.error).toContain("locked");
    expect(body.details).toEqual({ remainingMinutes: 12 });
    expect(body.statusCode).toBe(403);

    // Verify audit logged LOGIN_LOCKED (not LOGIN_FAILURE) for lockout attempts
    const { prisma } = await import("../shared/prisma.js");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "LOGIN_LOCKED",
        }),
      }),
    );
  });

  it("preserves details through Fastify serialization", async () => {
    const { isAccountLocked } = await import("../modules/auth/login-attempts.service.js");
    vi.mocked(isAccountLocked).mockResolvedValue({
      locked: true,
      remainingMinutes: 5,
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        emailOrUsername: "user@test.com",
        password: "wrong",
      },
    });

    const body = res.json();
    expect(body.statusCode).toBe(403);
    expect(body.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(body.details).toBeDefined();
    expect(body.details.remainingMinutes).toBe(5);
  });
});
