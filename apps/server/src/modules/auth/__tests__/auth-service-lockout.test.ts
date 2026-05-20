import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeEmailServiceClass,
  makeTrustedDeviceServiceClass,
  makeTwoFactorServiceClass,
  makeUserRepositoryClass,
} from "../../../__tests__/fixtures/auth-mocks.js";

// Mock all dependencies before importing the service
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    loginAttempt: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../login-attempts.service.js", () => ({
  isAccountLocked: vi.fn(),
  recordLoginAttempt: vi.fn(),
}));

vi.mock("../refresh-token.service.js", () => ({
  createRefreshToken: vi.fn(),
  revokeAllUserTokens: vi.fn(),
}));

vi.mock("../token-version.js", () => ({
  invalidateTokenVersionCache: vi.fn(),
}));

vi.mock("../trusted-device.service.js", () => ({
  TrustedDeviceService: makeTrustedDeviceServiceClass(),
}));

vi.mock("../../two-factor/service.js", () => ({
  TwoFactorService: makeTwoFactorServiceClass(false),
}));

vi.mock("../../email/service.js", () => ({
  EmailService: makeEmailServiceClass(),
}));

vi.mock("../../user/repository.js", () => ({
  PrismaUserRepository: makeUserRepositoryClass(),
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
}));

vi.mock("../../user/dto.js", () => ({
  UserResponseSchema: {
    parse: vi.fn((user) => user),
  },
}));

import { AppError } from "../../../utils/app-error.js";
import { isAccountLocked } from "../login-attempts.service.js";
import { AuthService } from "../service.js";

async function catchLoginError(authService: AuthService): Promise<unknown> {
  return authService
    .login({ emailOrUsername: "user@test.com", password: "pass" }, "UA", "1.2.3.4")
    .catch((e: unknown) => e);
}

describe("AuthService.login — account lockout (TD-2)", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
  });

  it("throws AppError with ACCOUNT_LOCKED code when account is locked", async () => {
    vi.mocked(isAccountLocked).mockResolvedValue({
      locked: true,
      remainingMinutes: 12,
    });

    const error = await catchLoginError(authService);

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(appErr.statusCode).toBe(403);
    expect(appErr.details).toEqual({ remainingMinutes: 12 });
  });

  it("includes the correct remainingMinutes in details", async () => {
    vi.mocked(isAccountLocked).mockResolvedValue({
      locked: true,
      remainingMinutes: 7,
    });

    const error = await catchLoginError(authService);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({ remainingMinutes: 7 });
  });

  it("does NOT use ErrorCodes.FORBIDDEN for account lockout", async () => {
    vi.mocked(isAccountLocked).mockResolvedValue({
      locked: true,
      remainingMinutes: 5,
    });

    const error = await catchLoginError(authService);

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).not.toBe(ErrorCodes.FORBIDDEN);
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
  });
});
