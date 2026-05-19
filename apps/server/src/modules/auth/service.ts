import crypto from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { EmailService } from "../email/service.js";
import { TwoFactorService } from "../two-factor/service.js";
import { UserResponseSchema } from "../user/dto.js";
import { PrismaUserRepository } from "../user/repository.js";
import type { LoginInput } from "./dto.js";
import { isAccountLocked, recordLoginAttempt } from "./login-attempts.service.js";
import { revokeAllUserTokens } from "./refresh-token.service.js";
import { invalidateTokenVersionCache } from "./token-version.js";
import { TrustedDeviceService } from "./trusted-device.service.js";

export class AuthService {
  private userRepository = new PrismaUserRepository();
  private emailService = new EmailService();
  private twoFactorService = new TwoFactorService();
  private trustedDeviceService = new TrustedDeviceService();

  async login(data: LoginInput, userAgent?: string, ipAddress?: string) {
    const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
    if (passwordAuthEnabled === "false") {
      throw new ForbiddenError(
        "Password authentication is disabled. Please use an external authentication provider.",
      );
    }

    const clientIp = ipAddress || "unknown";

    // Check account lockout BEFORE any credential validation.
    // Uses the email/username from the request (works for non-existent accounts too).
    const lockStatus = await isAccountLocked(data.emailOrUsername, clientIp);
    if (lockStatus.locked) {
      throw new AppError(
        403,
        `Account temporarily locked. Try again in ${lockStatus.remainingMinutes} minutes.`,
        ErrorCodes.ACCOUNT_LOCKED,
        { remainingMinutes: lockStatus.remainingMinutes },
      );
    }

    const user = await this.userRepository.findUserByEmailOrUsername(data.emailOrUsername);
    if (!user) {
      await recordLoginAttempt(data.emailOrUsername, clientIp, false);
      throw new UnauthorizedError("Invalid credentials");
    }

    if (!user.isActive) {
      throw new ForbiddenError("Account is inactive. Please contact an administrator.");
    }

    if (!user.password) {
      throw new ForbiddenError(
        "This account uses external authentication. Please use the appropriate login method.",
      );
    }

    const isValid = await bcrypt.compare(data.password, user.password);

    if (!isValid) {
      await recordLoginAttempt(data.emailOrUsername, clientIp, false);
      throw new UnauthorizedError("Invalid credentials");
    }

    // Record successful login
    await recordLoginAttempt(data.emailOrUsername, clientIp, true);

    const has2FA = await this.twoFactorService.isEnabled(user.id);

    if (has2FA) {
      if (userAgent && ipAddress) {
        const isDeviceTrusted = await this.trustedDeviceService.isDeviceTrusted(
          user.id,
          userAgent,
          ipAddress,
        );
        if (isDeviceTrusted) {
          // Update last used timestamp for trusted device
          await this.trustedDeviceService.updateLastUsed(user.id, userAgent, ipAddress);
          return UserResponseSchema.parse(user);
        }
      }

      return {
        requiresTwoFactor: true,
        userId: user.id,
        message: "Two-factor authentication required",
      };
    }

    return UserResponseSchema.parse(user);
  }

  async completeTwoFactorLogin(
    userId: string,
    token: string,
    rememberDevice: boolean = false,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.isActive) {
      throw new ForbiddenError("Account is inactive. Please contact an administrator.");
    }

    const verificationResult = await this.twoFactorService.verifyToken(userId, token);

    if (!verificationResult.success) {
      throw new UnauthorizedError("Invalid two-factor authentication code");
    }

    if (rememberDevice && userAgent && ipAddress) {
      await this.trustedDeviceService.addTrustedDevice(userId, userAgent, ipAddress);
    } else if (userAgent && ipAddress) {
      // Update last used timestamp if this is already a trusted device
      const isDeviceTrusted = await this.trustedDeviceService.isDeviceTrusted(
        userId,
        userAgent,
        ipAddress,
      );
      if (isDeviceTrusted) {
        await this.trustedDeviceService.updateLastUsed(userId, userAgent, ipAddress);
      }
    }

    return UserResponseSchema.parse(user);
  }

  async requestPasswordReset(email: string, origin: string) {
    const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
    if (passwordAuthEnabled === "false") {
      throw new ForbiddenError(
        "Password authentication is disabled. Password reset is not available.",
      );
    }

    const user = await this.userRepository.findUserByEmail(email);
    if (!user) {
      return;
    }

    const token = crypto.randomBytes(128).toString("hex");
    const expirationSeconds = Number(await getConfigValue("passwordResetTokenExpiration"));

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + expirationSeconds * 1000),
      },
    });

    try {
      await this.emailService.sendPasswordResetEmail(email, token, origin);
    } catch (error) {
      getLogger().error({ err: error }, "Failed to send password reset email");
      throw new ValidationError("Failed to send password reset email");
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<{ userId: string }> {
    // Look up the reset request first to check if user is LDAP-managed.
    // LDAP users need to set their initial app password even when password auth is disabled.
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        token,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!resetRequest) {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    // Allow password reset for LDAP users even when password auth is disabled
    // (they need to set their initial app password via the welcome email link)
    const isLdapUser = !!resetRequest.user.ldapDn;
    if (!isLdapUser) {
      const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
      if (passwordAuthEnabled === "false") {
        throw new ForbiddenError(
          "Password authentication is disabled. Password reset is not available.",
        );
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRequest.userId },
        // NOTE: tokenVersion increment is inlined (not using incrementTokenVersion helper)
        // because it must be atomic with the password update. After this transaction,
        // invalidateTokenVersionCache MUST be called — see below.
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      }),
      prisma.passwordReset.update({
        where: { id: resetRequest.id },
        data: { used: true },
      }),
    ]);

    // Invalidate cached tokenVersion so existing sessions are rejected immediately
    invalidateTokenVersionCache(resetRequest.userId);
    // Also revoke all refresh tokens — password was just changed
    await revokeAllUserTokens(resetRequest.userId);

    return { userId: resetRequest.userId };
  }

  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return UserResponseSchema.parse(user);
  }

  async getTrustedDevices(userId: string) {
    return await this.trustedDeviceService.getUserTrustedDevices(userId);
  }

  async removeTrustedDevice(userId: string, deviceId: string) {
    return await this.trustedDeviceService.removeTrustedDevice(userId, deviceId);
  }

  async removeAllTrustedDevices(userId: string) {
    const result = await this.trustedDeviceService.removeAllTrustedDevices(userId);
    return {
      success: true,
      message: "All trusted devices removed successfully",
      removedCount: result.count,
    };
  }
}
