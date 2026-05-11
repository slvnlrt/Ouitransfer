import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { TwoFactorService } from "../service.js";

describe("TwoFactorService.disable2FA (5.13)", () => {
  const service = new TwoFactorService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds with valid password + TOTP code", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
    const validToken = totp.generate();
    const password = "correct-password";
    const hashedPassword = await bcrypt.hash(password, 10);

    // Use `as never` for mock values — clean, simple, no conditional-type gymnastics.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await expect(service.disable2FA("user-1", password, validToken)).resolves.toEqual({
      success: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ twoFactorEnabled: false }),
      }),
    );
  });

  it("rejects invalid TOTP code even with correct password", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const password = "correct-password";
    const hashedPassword = await bcrypt.hash(password, 10);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);

    await expect(service.disable2FA("user-1", password, "000000")).rejects.toThrow();
  });

  it("rejects wrong password even with valid TOTP", async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
    const validToken = totp.generate();
    const hashedPassword = await bcrypt.hash("real-password", 10);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      password: hashedPassword,
      twoFactorEnabled: true,
      twoFactorSecret: secret.base32,
      twoFactorBackupCodes: null,
    } as never);

    await expect(service.disable2FA("user-1", "wrong-password", validToken)).rejects.toThrow(
      "Invalid password",
    );
  });
});
