import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  TrustedDeviceService: class {
    isDeviceTrusted = vi.fn().mockResolvedValue(false);
    addTrustedDevice = vi.fn();
    updateLastUsed = vi.fn();
    getUserTrustedDevices = vi.fn();
    removeTrustedDevice = vi.fn();
    removeAllTrustedDevices = vi.fn();
  },
}));

vi.mock("../../two-factor/service.js", () => ({
  TwoFactorService: class {
    isEnabled = vi.fn().mockResolvedValue(false);
    verifyToken = vi.fn();
  },
}));

vi.mock("../../email/service.js", () => ({
  EmailService: class {
    sendPasswordResetEmail = vi.fn();
  },
}));

vi.mock("../../user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmailOrUsername = vi.fn();
    findUserByEmail = vi.fn();
  },
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
}));

vi.mock("../../user/dto.js", () => ({
  UserResponseSchema: {
    parse: vi.fn((user) => user),
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() },
}));

vi.mock("../../audit/service.js", () => ({
  AuditService: class {
    logAuditEvent = vi.fn();
  },
  logAuditEvent: vi.fn(),
}));

import { prisma } from "../../../shared/prisma.js";
import { AppError } from "../../../utils/app-error.js";
import type { TwoFactorService } from "../../two-factor/service.js";
import type { PrismaUserRepository } from "../../user/repository.js";
import { isAccountLocked, recordLoginAttempt } from "../login-attempts.service.js";
import { AuthService } from "../service.js";
import type { TrustedDeviceService } from "../trusted-device.service.js";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  username: "testuser",
  firstName: "Test",
  lastName: "User",
  isAdmin: false,
  isActive: true,
  password: "$2a$10$hashedpassword",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("AuthService.completeTwoFactorLogin — 2FA lockout (TD-3)", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
    // Default: not locked
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: false, remainingMinutes: 0 });
    // Default: user found and active
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
  });

  it("throws AppError with ACCOUNT_LOCKED when account is locked", async () => {
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: true, remainingMinutes: 5 });

    const error = await authService
      .completeTwoFactorLogin("user-1", "123456", false, "UA", "1.2.3.4")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(appErr.statusCode).toBe(403);
    expect(appErr.details).toEqual({ remainingMinutes: 5 });
  });

  it("records failed attempt on invalid 2FA token", async () => {
    const twoFactorInstance = (authService as unknown as { twoFactorService: TwoFactorService })
      .twoFactorService;
    vi.mocked(twoFactorInstance.verifyToken).mockResolvedValue({
      success: false,
      method: "totp" as const,
    });

    const error = await authService
      .completeTwoFactorLogin("user-1", "wrong-token", false, "UA", "1.2.3.4")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith(mockUser.email, "1.2.3.4", false);
  });

  it("records successful attempt on valid 2FA token", async () => {
    const twoFactorInstance = (authService as unknown as { twoFactorService: TwoFactorService })
      .twoFactorService;
    vi.mocked(twoFactorInstance.verifyToken).mockResolvedValue({
      success: true,
      method: "totp" as const,
    });

    await authService.completeTwoFactorLogin("user-1", "123456", false, "UA", "1.2.3.4");

    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith(mockUser.email, "1.2.3.4", true);
  });

  it("does NOT record success=true when lockout throws before verification", async () => {
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: true, remainingMinutes: 3 });

    await authService
      .completeTwoFactorLogin("user-1", "123456", false, "UA", "1.2.3.4")
      .catch(() => {});

    expect(vi.mocked(recordLoginAttempt)).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      true,
    );
  });
});

describe("AuthService.login — 2FA deferral of success recording (TD-3)", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
    // Default: not locked
    vi.mocked(isAccountLocked).mockResolvedValue({ locked: false, remainingMinutes: 0 });
    // Default: user found
    const userRepo = (authService as unknown as { userRepository: PrismaUserRepository })
      .userRepository;
    vi.mocked(userRepo.findUserByEmailOrUsername).mockResolvedValue(mockUser as never);
  });

  it("does NOT record success when 2FA is required and device is not trusted", async () => {
    const twoFactorInstance = (authService as unknown as { twoFactorService: TwoFactorService })
      .twoFactorService;
    vi.mocked(twoFactorInstance.isEnabled).mockResolvedValue(true);

    const trustedDeviceInstance = (
      authService as unknown as { trustedDeviceService: TrustedDeviceService }
    ).trustedDeviceService;
    vi.mocked(trustedDeviceInstance.isDeviceTrusted).mockResolvedValue(false);

    const result = await authService.login(
      { emailOrUsername: "test@example.com", password: "pass" },
      "UA",
      "1.2.3.4",
    );

    // Should get the 2FA required response, not a user object
    expect(result).toMatchObject({ requiresTwoFactor: true, userId: "user-1" });

    // recordLoginAttempt should NOT have been called with success=true
    expect(vi.mocked(recordLoginAttempt)).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      true,
    );
  });

  it("records success when device is trusted (bypasses 2FA)", async () => {
    const twoFactorInstance = (authService as unknown as { twoFactorService: TwoFactorService })
      .twoFactorService;
    vi.mocked(twoFactorInstance.isEnabled).mockResolvedValue(true);

    const trustedDeviceInstance = (
      authService as unknown as { trustedDeviceService: TrustedDeviceService }
    ).trustedDeviceService;
    vi.mocked(trustedDeviceInstance.isDeviceTrusted).mockResolvedValue(true);

    await authService.login(
      { emailOrUsername: "test@example.com", password: "pass" },
      "UA",
      "1.2.3.4",
    );

    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith("test@example.com", "1.2.3.4", true);
  });

  it("records success when no 2FA (normal flow)", async () => {
    const twoFactorInstance = (authService as unknown as { twoFactorService: TwoFactorService })
      .twoFactorService;
    vi.mocked(twoFactorInstance.isEnabled).mockResolvedValue(false);

    await authService.login(
      { emailOrUsername: "test@example.com", password: "pass" },
      "UA",
      "1.2.3.4",
    );

    expect(vi.mocked(recordLoginAttempt)).toHaveBeenCalledWith("test@example.com", "1.2.3.4", true);
  });
});
