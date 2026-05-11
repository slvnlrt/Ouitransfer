import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { prisma } from "../../shared/prisma.js";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { timingSafeEqual } from "../../utils/timing-safe.js";
import { incrementTokenVersion } from "../auth/token-version.js";

interface BackupCode {
  code: string;
  used: boolean;
}

export class TwoFactorService {
  /**
   * Generate a new 2FA secret and QR code for setup
   */
  async generateSetup(userId: string, userEmail: string, appName?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.twoFactorEnabled) {
      throw new ConflictError("Two-factor authentication is already enabled");
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: appName || "OUITRANSFER",
      label: userEmail,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: secret,
    });

    const qrCodeUrl = await QRCode.toDataURL(totp.toString());

    return {
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
      backupCodes: await this.generateBackupCodes(),
    };
  }

  /**
   * Verify setup token and enable 2FA
   */
  async verifySetup(userId: string, token: string, secret: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.twoFactorEnabled) {
      throw new ConflictError("Two-factor authentication is already enabled");
    }

    const setupTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const normalizedToken = token.replace(/[\s-]/g, "");
    const verified = setupTotp.validate({ token: normalizedToken, window: 1 }) !== null;

    if (!verified) {
      throw new UnauthorizedError("Invalid verification code");
    }

    const backupCodes = await this.generateBackupCodes();

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorBackupCodes: JSON.stringify(backupCodes),
        twoFactorVerified: true,
      },
    });

    // Invalidate existing sessions — 2FA status change is a privilege escalation event
    await incrementTokenVersion(userId);

    return {
      success: true,
      backupCodes: backupCodes.map((bc) => bc.code),
    };
  }

  /**
   * Verify a 2FA token during login
   */
  async verifyToken(userId: string, token: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    const loginTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    });
    const normalizedToken = token.replace(/[\s-]/g, "");
    const verified = loginTotp.validate({ token: normalizedToken, window: 1 }) !== null;

    if (verified) {
      return { success: true, method: "totp" };
    }

    if (user.twoFactorBackupCodes) {
      const backupCodes: BackupCode[] = JSON.parse(user.twoFactorBackupCodes);
      const backupCodeIndex = backupCodes.findIndex(
        (bc) => !bc.used && timingSafeEqual(bc.code, token),
      );

      if (backupCodeIndex !== -1) {
        backupCodes[backupCodeIndex].used = true;

        await prisma.user.update({
          where: { id: userId },
          data: {
            twoFactorBackupCodes: JSON.stringify(backupCodes),
          },
        });

        return { success: true, method: "backup" };
      }
    }

    throw new UnauthorizedError("Invalid verification code");
  }

  /**
   * Disable 2FA for a user
   * Requires both password AND a valid TOTP code (or backup code) to prevent
   * an attacker with only the password from disabling 2FA.
   */
  async disable2FA(userId: string, password: string, totpCode: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    if (!user.password) {
      throw new ValidationError("Password verification required");
    }

    let isValidPassword = false;
    try {
      isValidPassword = await bcrypt.compare(password, user.password);
    } catch (error) {
      getLogger().error({ err: error }, "bcrypt.compare error");
      throw new UnauthorizedError("Password verification failed");
    }
    if (!isValidPassword) {
      throw new UnauthorizedError("Invalid password");
    }

    if (!user.twoFactorSecret) {
      throw new ValidationError("Two-factor secret not found");
    }

    // Verify TOTP code — follow the same pattern as verifyToken
    const disableTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    });
    const normalizedCode = totpCode.replace(/[\s-]/g, "");
    const totpVerified = disableTotp.validate({ token: normalizedCode, window: 1 }) !== null;

    if (totpVerified) {
      // TOTP code is valid — proceed to disable
    } else if (user.twoFactorBackupCodes) {
      // Try backup code as a fallback
      const backupCodes: BackupCode[] = JSON.parse(user.twoFactorBackupCodes);
      const backupCodeIndex = backupCodes.findIndex(
        (bc) => !bc.used && timingSafeEqual(bc.code, normalizedCode),
      );

      if (backupCodeIndex === -1) {
        throw new UnauthorizedError("Invalid verification code");
      }

      // Mark backup code as used
      backupCodes[backupCodeIndex].used = true;
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: JSON.stringify(backupCodes) },
      });
    } else {
      throw new UnauthorizedError("Invalid verification code");
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorVerified: false,
      },
    });

    // Invalidate existing sessions — 2FA status change is a privilege escalation event
    await incrementTokenVersion(userId);

    return { success: true };
  }

  /**
   * Generate new backup codes
   */
  async generateNewBackupCodes(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    const backupCodes = await this.generateBackupCodes();

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorBackupCodes: JSON.stringify(backupCodes),
      },
    });

    return backupCodes.map((bc) => bc.code);
  }

  /**
   * Get 2FA status for a user
   */
  async getStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorVerified: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    let availableBackupCodes = 0;
    if (user.twoFactorBackupCodes) {
      const backupCodes: BackupCode[] = JSON.parse(user.twoFactorBackupCodes);
      availableBackupCodes = backupCodes.filter((bc) => !bc.used).length;
    }

    return {
      enabled: user.twoFactorEnabled,
      verified: user.twoFactorVerified,
      availableBackupCodes,
    };
  }

  /**
   * Generate backup codes
   */
  private async generateBackupCodes(): Promise<BackupCode[]> {
    const codes: BackupCode[] = [];

    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      codes.push({
        code: code.match(/.{1,4}/g)?.join("-") || code,
        used: false,
      });
    }

    return codes;
  }

  /**
   * Check if user has 2FA enabled
   */
  async isEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    return user?.twoFactorEnabled ?? false;
  }
}
