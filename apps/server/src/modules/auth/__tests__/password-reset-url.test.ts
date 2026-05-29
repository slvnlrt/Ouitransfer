/**
 * password-reset-url.test.ts
 *
 * Verifies that `requestPasswordReset` builds the reset URL from the
 * admin-configured `appUrl` (via `buildResetPasswordUrl`), NOT from any
 * client-supplied origin. This prevents phishing via attacker-controlled URLs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockFindUserByEmail,
  mockPasswordResetCreate,
  mockEmailSend,
  mockBuildResetPasswordUrl,
  mockGetConfigValue,
} = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
  mockPasswordResetCreate: vi.fn().mockResolvedValue({}),
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
  mockBuildResetPasswordUrl: vi
    .fn()
    .mockResolvedValue("https://configured-app.example.com/auth/reset-password/some-token"),
  mockGetConfigValue: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    passwordReset: { create: mockPasswordResetCreate },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: mockEmailSend },
}));

vi.mock("../../email/url-builder.js", () => ({
  buildResetPasswordUrl: mockBuildResetPasswordUrl,
}));

vi.mock("../../user/repository.js", () => ({
  PrismaUserRepository: class {
    findUserByEmailOrUsername = vi.fn();
    findUserByEmail = mockFindUserByEmail;
  },
}));

vi.mock("../../user/dto.js", () => ({
  UserResponseSchema: { parse: vi.fn((u: unknown) => u) },
}));

vi.mock("../../two-factor/service.js", () => ({
  TwoFactorService: class {
    isEnabled = vi.fn().mockResolvedValue(false);
    verifyToken = vi.fn();
  },
}));

vi.mock("../trusted-device.service.js", () => ({
  TrustedDeviceService: class {
    isDeviceTrusted = vi.fn().mockResolvedValue(false);
  },
}));

vi.mock("../login-attempts.service.js", () => ({
  isAccountLocked: vi.fn().mockResolvedValue({ locked: false }),
  recordLoginAttempt: vi.fn(),
}));

vi.mock("../refresh-token.service.js", () => ({
  revokeAllUserTokens: vi.fn(),
}));

vi.mock("../token-version.js", () => ({
  invalidateTokenVersionCache: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { AuthService } from "../service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuthService.requestPasswordReset — URL security", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();

    mockGetConfigValue.mockImplementation(async (key: string) => {
      if (key === "passwordAuthEnabled") return "true";
      if (key === "passwordResetTokenExpiration") return "3600";
      if (key === "passwordMinLength") return "8";
      return "";
    });
  });

  it("uses buildResetPasswordUrl (admin-configured appUrl), not a client-supplied origin", async () => {
    const user = {
      id: "user-1",
      email: "victim@example.com",
      locale: "en",
      ldapDn: null,
      password: "hashed",
    };
    mockFindUserByEmail.mockResolvedValue(user);

    // The method no longer accepts an origin parameter
    await authService.requestPasswordReset("victim@example.com");

    // buildResetPasswordUrl must have been called with the generated token
    expect(mockBuildResetPasswordUrl).toHaveBeenCalledOnce();
    expect(mockBuildResetPasswordUrl).toHaveBeenCalledWith(expect.any(String));

    // The email must use the URL from buildResetPasswordUrl
    expect(mockEmailSend).toHaveBeenCalledWith(
      "password_reset",
      expect.objectContaining({
        to: "victim@example.com",
        data: expect.objectContaining({
          resetUrl: "https://configured-app.example.com/auth/reset-password/some-token",
        }),
      }),
    );
  });

  it("does not accept or use any origin parameter", () => {
    // TypeScript compile-time check: the method signature should only accept email
    // This test documents the API contract change
    expect(authService.requestPasswordReset.length).toBeLessThanOrEqual(1);
  });
});
