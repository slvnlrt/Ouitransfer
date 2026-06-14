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
import { decryptSecret, encryptSecret } from "../../utils/encryption.js";
import { getLogger } from "../../utils/logger.js";
import { timingSafeEqual } from "../../utils/timing-safe.js";
import { incrementTokenVersion } from "../auth/token-version.js";
import { TrustedDeviceService } from "../auth/trusted-device.service.js";

/** Domain-separation label for the encrypted TOTP secret (see utils/encryption.ts). */
const TOTP_SECRET_PURPOSE = "totp-secret";

/** TOTP period in seconds (RFC 6238). The current time-step is floor(now/period). */
const TOTP_PERIOD = 30;

/** Validation window (in steps) on either side of the current step. */
const TOTP_WINDOW = 1;

/**
 * A backup code as persisted in the DB. The plaintext code is never stored —
 * only an HMAC-SHA256 hash, so a DB leak does not yield usable second factors.
 */
interface StoredBackupCode {
  hash: string;
  used: boolean;
}

/**
 * Result of a successful TOTP verification, including the consumed time-step so
 * callers can persist it for replay protection (RFC 6238 §5.2).
 */
interface TwoFactorVerificationResult {
  success: boolean;
  method: "totp" | "backup";
  /** The TOTP time-step consumed (only set for method === "totp"). */
  consumedStep?: number;
}

export class TwoFactorService {
  private trustedDeviceService = new TrustedDeviceService();

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
      period: TOTP_PERIOD,
      secret: secret,
    });

    const qrCodeUrl = await QRCode.toDataURL(totp.toString());

    // Generate the backup codes once: return the plaintext to the client (the only
    // time they are ever visible) and keep the hashes for persistence at enable time.
    const { plaintext } = this.generateBackupCodes();

    return {
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
      backupCodes: plaintext.map((code) => ({ code, used: false })),
    };
  }

  /**
   * Verify setup token and enable 2FA.
   *
   * Requires the user's current password (A1-05): enabling 2FA is a security-
   * sensitive change, so a session-riding attacker must not be able to enroll
   * their own authenticator without knowing the password. This mirrors the
   * password gate already enforced on {@link disable2FA}.
   */
  async verifySetup(userId: string, token: string, secret: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, twoFactorEnabled: true },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.twoFactorEnabled) {
      throw new ConflictError("Two-factor authentication is already enabled");
    }

    await this.assertPassword(user.password, password);

    const setupTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const normalizedToken = token.replace(/[\s-]/g, "");
    const delta = setupTotp.validate({ token: normalizedToken, window: TOTP_WINDOW });

    if (delta === null) {
      throw new UnauthorizedError("Invalid verification code");
    }

    const { plaintext, stored } = this.generateBackupCodes();
    const consumedStep = this.currentStep() + delta;

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        // Encrypt the TOTP secret at rest — a DB leak must not expose the seed.
        twoFactorSecret: encryptSecret(secret, TOTP_SECRET_PURPOSE),
        twoFactorBackupCodes: JSON.stringify(stored),
        twoFactorVerified: true,
        // Consume the step used during setup so it cannot be replayed at login.
        lastTotpStep: consumedStep,
      },
    });

    // Invalidate existing sessions — 2FA status change is a privilege escalation event
    await incrementTokenVersion(userId);

    return {
      success: true,
      backupCodes: plaintext,
    };
  }

  /**
   * Verify a 2FA token during login.
   *
   * Rejects replay of a TOTP step that has already been consumed (≤ lastTotpStep)
   * and consumes the step on success. Backup codes are matched against stored
   * HMAC hashes and marked used.
   */
  async verifyToken(userId: string, token: string): Promise<TwoFactorVerificationResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
        lastTotpStep: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    const secret = decryptSecret(user.twoFactorSecret, TOTP_SECRET_PURPOSE);
    const loginTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const normalizedToken = token.replace(/[\s-]/g, "");
    const delta = loginTotp.validate({ token: normalizedToken, window: TOTP_WINDOW });

    if (delta !== null) {
      const matchedStep = this.currentStep() + delta;

      // Replay protection (RFC 6238 §5.2): reject any step at or below the last
      // successfully consumed step — a captured code cannot be reused.
      if (user.lastTotpStep !== null && matchedStep <= user.lastTotpStep) {
        throw new UnauthorizedError("Invalid verification code");
      }

      // Atomically consume the step. The conditional update closes the TOCTOU race:
      // two concurrent requests presenting the same step — only one advances the
      // stored step, the other's update matches zero rows and is rejected.
      const consumed = await prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: matchedStep } }],
        },
        data: { lastTotpStep: matchedStep },
      });

      if (consumed.count === 0) {
        throw new UnauthorizedError("Invalid verification code");
      }

      return { success: true, method: "totp", consumedStep: matchedStep };
    }

    if (user.twoFactorBackupCodes) {
      const backupCodes: StoredBackupCode[] = JSON.parse(user.twoFactorBackupCodes);
      const candidateHash = this.hashBackupCode(normalizedToken);
      // timingSafeEqual compares the candidate hash against each stored hash in
      // constant time. The stored values are hashes (not the codes themselves),
      // so even a DB leak does not reveal usable codes.
      const backupCodeIndex = backupCodes.findIndex(
        (bc) => !bc.used && timingSafeEqual(bc.hash, candidateHash),
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
        lastTotpStep: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    await this.assertPassword(user.password, password);

    if (!user.twoFactorSecret) {
      throw new ValidationError("Two-factor secret not found");
    }

    // Require a valid current TOTP code or unused backup code (step-up).
    this.assertSecondFactor(user, totpCode);

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorVerified: false,
        lastTotpStep: null,
      },
    });

    // Invalidate existing sessions — 2FA status change is a privilege escalation event
    await incrementTokenVersion(userId);

    // A1-09: revoke trusted devices when 2FA is disabled. Trusted-device records
    // only exist to let a device skip the 2FA prompt; once 2FA is off they are
    // meaningless, and leaving them would let an attacker-trusted device retain a
    // 2FA bypass if the victim later re-enables 2FA.
    await this.trustedDeviceService.removeAllTrustedDevices(userId);

    return { success: true };
  }

  /**
   * Generate new backup codes.
   *
   * Requires recent re-authentication — password AND a current TOTP/backup code
   * step-up (A1-05) — mirroring {@link disable2FA}, so a session-riding attacker
   * cannot silently rotate (and exfiltrate) the victim's backup codes.
   */
  async generateNewBackupCodes(userId: string, password: string, totpCode: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
        lastTotpStep: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (!user.twoFactorEnabled) {
      throw new ValidationError("Two-factor authentication is not enabled");
    }

    await this.assertPassword(user.password, password);

    if (!user.twoFactorSecret) {
      throw new ValidationError("Two-factor secret not found");
    }

    this.assertSecondFactor(user, totpCode);

    const { plaintext, stored } = this.generateBackupCodes();

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorBackupCodes: JSON.stringify(stored),
      },
    });

    return plaintext;
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
      const backupCodes: StoredBackupCode[] = JSON.parse(user.twoFactorBackupCodes);
      availableBackupCodes = backupCodes.filter((bc) => !bc.used).length;
    }

    return {
      enabled: user.twoFactorEnabled,
      verified: user.twoFactorVerified,
      availableBackupCodes,
    };
  }

  /**
   * Verify the user's password (step-up re-authentication). Throws if the
   * account has no password (external auth) or the password is wrong.
   */
  private async assertPassword(passwordHash: string | null, password: string): Promise<void> {
    if (!passwordHash) {
      throw new ValidationError("Password verification required");
    }
    let isValidPassword = false;
    try {
      isValidPassword = await bcrypt.compare(password, passwordHash);
    } catch (error) {
      getLogger().error({ err: error }, "bcrypt.compare error");
      throw new UnauthorizedError("Password verification failed");
    }
    if (!isValidPassword) {
      throw new UnauthorizedError("Invalid password");
    }
  }

  /**
   * Verify a current TOTP code (with replay protection) or, failing that, an
   * unused backup code. Throws `UnauthorizedError` when neither matches.
   *
   * NOTE: this is a re-authentication gate (disable / regenerate backup codes),
   * NOT the login path, so it does not consume the TOTP step or mark the backup
   * code used — the caller's subsequent action (disabling 2FA / rotating codes)
   * invalidates the relevant material anyway.
   */
  private assertSecondFactor(
    user: {
      twoFactorSecret: string | null;
      twoFactorBackupCodes: string | null;
      lastTotpStep: number | null;
    },
    code: string,
  ): void {
    if (!user.twoFactorSecret) {
      throw new ValidationError("Two-factor secret not found");
    }

    const secret = decryptSecret(user.twoFactorSecret, TOTP_SECRET_PURPOSE);
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const normalizedCode = code.replace(/[\s-]/g, "");
    const delta = totp.validate({ token: normalizedCode, window: TOTP_WINDOW });
    let totpVerified = delta !== null;

    // Reject a TOTP step that has already been consumed (replay protection).
    if (totpVerified) {
      const matchedStep = this.currentStep() + (delta as number);
      if (user.lastTotpStep !== null && matchedStep <= user.lastTotpStep) {
        totpVerified = false;
      }
    }

    if (totpVerified) {
      return;
    }

    // Fall back to an unused backup code.
    if (!user.twoFactorBackupCodes) {
      throw new UnauthorizedError("Invalid verification code");
    }
    const backupCodes: StoredBackupCode[] = JSON.parse(user.twoFactorBackupCodes);
    const candidateHash = this.hashBackupCode(normalizedCode);
    const matched = backupCodes.some((bc) => !bc.used && timingSafeEqual(bc.hash, candidateHash));
    if (!matched) {
      throw new UnauthorizedError("Invalid verification code");
    }
  }

  /** The current TOTP time-step (floor of unix-seconds / period). */
  private currentStep(): number {
    return Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  }

  /**
   * HMAC-SHA256 a normalized backup code, keyed by ENCRYPTION_SECRET. Used so
   * that backup codes are stored as keyed hashes (not plaintext) and matched by
   * comparing hashes. The code is uppercased and stripped of separators first so
   * user-entered formatting (spaces/dashes/case) does not affect matching.
   */
  private hashBackupCode(code: string): string {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      throw new Error("ENCRYPTION_SECRET environment variable is required to hash backup codes");
    }
    const normalized = code.replace(/[\s-]/g, "").toUpperCase();
    return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
  }

  /**
   * Generate backup codes.
   *
   * Each code carries 80 bits of entropy (`crypto.randomBytes(10)`), formatted as
   * groups of 4 uppercase hex chars. Returns both the plaintext (shown to the user
   * exactly once) and the persisted form (HMAC hashes only).
   */
  private generateBackupCodes(): { plaintext: string[]; stored: StoredBackupCode[] } {
    const plaintext: string[] = [];
    const stored: StoredBackupCode[] = [];

    for (let i = 0; i < 10; i++) {
      const raw = crypto.randomBytes(10).toString("hex").toUpperCase();
      const code = raw.match(/.{1,4}/g)?.join("-") || raw;
      plaintext.push(code);
      stored.push({ hash: this.hashBackupCode(code), used: false });
    }

    return { plaintext, stored };
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
