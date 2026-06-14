import crypto from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { hashToken } from "../../utils/token-hash.js";
import { getConfigValue } from "../config/service.js";
import { emailService } from "../email/service.js";
import { buildResetPasswordUrl } from "../email/url-builder.js";
import { TwoFactorService } from "../two-factor/service.js";
import { UserResponseSchema } from "../user/dto.js";
import { PrismaUserRepository } from "../user/repository.js";
import type { LoginInput } from "./dto.js";
import { isAccountLocked, isIpThrottled, recordLoginAttempt } from "./login-attempts.service.js";
import { BCRYPT_COST } from "./password-policy.js";
import { revokeAllUserTokens } from "./refresh-token.service.js";
import { invalidateTokenVersionCache } from "./token-version.js";
import { TrustedDeviceService } from "./trusted-device.service.js";

/**
 * Fixed bcrypt hash used as a decoy for the constant-time user-existence mask
 * (A1-10). When the submitted account does not exist, login still performs a
 * real bcrypt comparison against this hash so the response latency is
 * indistinguishable from a wrong-password attempt on an existing account. The
 * value is a valid cost-12 bcrypt hash of a random string (it can never match a
 * real password). Generated once at module load to avoid per-request hashing.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), BCRYPT_COST);

export class AuthService {
  private userRepository = new PrismaUserRepository();
  private twoFactorService = new TwoFactorService();
  private trustedDeviceService = new TrustedDeviceService();

  async login(data: LoginInput, _userAgent?: string, ipAddress?: string, deviceSecret?: string) {
    const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
    if (passwordAuthEnabled === "false") {
      throw new ForbiddenError(
        "Password authentication is disabled. Please use an external authentication provider.",
      );
    }

    const clientIp = ipAddress || "unknown";

    // Per-IP throttle BEFORE the per-email lockout: brakes credential-stuffing
    // that spreads one guess across many emails from a single source IP (A1-01).
    const ipThrottle = await isIpThrottled(clientIp);
    if (ipThrottle.throttled) {
      throw new AppError(
        403,
        `Too many failed login attempts from your network. Try again in ${ipThrottle.remainingMinutes} minutes.`,
        ErrorCodes.ACCOUNT_LOCKED,
        { remainingMinutes: ipThrottle.remainingMinutes },
      );
    }

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

    // A1-10: always run a bcrypt comparison — against the user's real hash when
    // it exists, otherwise against a fixed decoy hash. This masks the
    // user-existence timing oracle (a non-existent account is no longer faster
    // than a wrong-password attempt) and avoids leaking distinct errors for
    // inactive / external-auth accounts. All pre-success failures return the
    // generic "Invalid credentials" so the response cannot distinguish
    // "no such user" from "valid but inactive/OIDC-only" from "wrong password".
    const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(data.password, passwordHash);

    // The login succeeds only when the user exists, is active, has a local
    // password, AND the password matches. Any other combination is funnelled
    // into the same generic failure below.
    const canLogin = !!user && user.isActive && !!user.password && isPasswordValid;

    if (!canLogin) {
      await recordLoginAttempt(data.emailOrUsername, clientIp, false);
      throw new UnauthorizedError("Invalid credentials");
    }

    const has2FA = await this.twoFactorService.isEnabled(user.id);

    if (has2FA) {
      // Trusted-device bypass keyed on the server-issued device secret (cookie),
      // never on spoofable UA/IP (A1-04).
      const isDeviceTrusted = await this.trustedDeviceService.isDeviceTrusted(
        user.id,
        deviceSecret,
      );
      if (isDeviceTrusted && deviceSecret) {
        // Trusted device bypass — full login complete, record success
        await this.trustedDeviceService.updateLastUsed(user.id, deviceSecret);
        await recordLoginAttempt(data.emailOrUsername, clientIp, true);
        return UserResponseSchema.parse(user);
      }

      // 2FA required — defer success recording to completeTwoFactorLogin
      return {
        requiresTwoFactor: true,
        userId: user.id,
        message: "Two-factor authentication required",
      };
    }

    // No 2FA — record successful login
    await recordLoginAttempt(data.emailOrUsername, clientIp, true);
    return UserResponseSchema.parse(user);
  }

  async completeTwoFactorLogin(
    userId: string,
    token: string,
    rememberDevice: boolean = false,
    userAgent?: string,
    ipAddress?: string,
    deviceSecret?: string,
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

    const clientIp = ipAddress || "unknown";

    // Per-IP throttle before 2FA verification (A1-01).
    const ipThrottle = await isIpThrottled(clientIp);
    if (ipThrottle.throttled) {
      throw new AppError(
        403,
        `Too many failed login attempts from your network. Try again in ${ipThrottle.remainingMinutes} minutes.`,
        ErrorCodes.ACCOUNT_LOCKED,
        { remainingMinutes: ipThrottle.remainingMinutes },
      );
    }

    // Check account lockout before attempting 2FA verification
    const lockStatus = await isAccountLocked(user.email, clientIp);
    if (lockStatus.locked) {
      throw new AppError(
        403,
        `Account temporarily locked. Try again in ${lockStatus.remainingMinutes} minutes.`,
        ErrorCodes.ACCOUNT_LOCKED,
        { remainingMinutes: lockStatus.remainingMinutes },
      );
    }

    const verificationResult = await this.twoFactorService.verifyToken(userId, token);

    if (!verificationResult.success) {
      await recordLoginAttempt(user.email, clientIp, false);
      throw new UnauthorizedError("Invalid two-factor authentication code");
    }

    // 2FA verified — full login complete
    await recordLoginAttempt(user.email, clientIp, true);

    // Trusted-device handling keyed on the server-issued device secret (A1-04).
    // `trustedDeviceSecret` is non-null only when a NEW secret must be set as a
    // cookie by the caller (i.e. the user opted to remember a not-yet-trusted device).
    let trustedDeviceSecret: string | undefined;

    if (rememberDevice) {
      // Reuse the existing cookie secret if present, otherwise mint a new one.
      const secret = deviceSecret || this.trustedDeviceService.generateDeviceSecret();
      await this.trustedDeviceService.addTrustedDevice(userId, secret, { userAgent, ipAddress });
      // Only return the secret to be set as a cookie when it is freshly minted.
      if (!deviceSecret) {
        trustedDeviceSecret = secret;
      }
    } else if (deviceSecret) {
      // Update last-used timestamp if this device is already trusted.
      const isDeviceTrusted = await this.trustedDeviceService.isDeviceTrusted(userId, deviceSecret);
      if (isDeviceTrusted) {
        await this.trustedDeviceService.updateLastUsed(userId, deviceSecret);
      }
    }

    return { user: UserResponseSchema.parse(user), trustedDeviceSecret };
  }

  /**
   * Begin a password reset. Always returns the generic shape regardless of
   * outcome to preserve the no-enumeration contract; the returned `userId` (set
   * only when a real reset was issued for an existing, eligible account) lets the
   * route attach a redaction-safe identifier to the audit event instead of the
   * raw submitted email (A1-16).
   */
  async requestPasswordReset(email: string): Promise<{ userId?: string }> {
    // Look up the user first — LDAP users are allowed to reset their password
    // even when passwordAuth is disabled (needed for welcome-email initial setup).
    const user = await this.userRepository.findUserByEmail(email);
    if (!user) {
      return {};
    }

    // A1-06: when password auth is disabled, a non-LDAP user must NOT be treated
    // differently from a non-existent email. Previously this branch threw
    // ForbiddenError for existing local accounts while unknown emails returned
    // 200 — a direct enumeration oracle. Now we silently return (the route still
    // sends the generic "if an account exists…" 200), so the response is
    // identical whether or not the email maps to a disabled-auth local user.
    const isLdapUser = !!user.ldapDn;
    if (!isLdapUser) {
      const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
      if (passwordAuthEnabled === "false") {
        return {};
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expirationSeconds = Number(await getConfigValue("passwordResetTokenExpiration"));

    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: hashToken(token),
        expiresAt: new Date(Date.now() + expirationSeconds * 1000),
      },
    });

    try {
      const resetUrl = await buildResetPasswordUrl(token);
      await emailService.send("password_reset", {
        to: email,
        locale: user.locale ?? "en",
        userId: user.id,
        data: {
          resetUrl,
          expiresInMinutes: Math.round(expirationSeconds / 60),
        },
      });
    } catch (error) {
      getLogger().error({ err: error }, "Failed to send password reset email");
      // Do NOT throw — preserve the no-user-enumeration contract.
      // Throwing here would let an attacker distinguish registered emails
      // (which fail with a validation error when appUrl is misconfigured)
      // from unregistered emails (which return 200 silently).
    }

    return { userId: user.id };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ userId: string }> {
    // Look up the reset request first to check if user is LDAP-managed.
    // LDAP users need to set their initial app password even when password auth is disabled.
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        token: hashToken(token),
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

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_COST);

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
    // A1-09: revoke trusted devices on password reset. A reset implies the
    // account may be compromised; a previously-trusted attacker device must no
    // longer be allowed to skip 2FA after the legitimate owner resets.
    await this.trustedDeviceService.removeAllTrustedDevices(resetRequest.userId);

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
