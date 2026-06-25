import crypto from "node:crypto";

import { TRUSTED_DEVICE_TTL_DAYS } from "../../config/auth.config.js";
import { prisma } from "../../shared/prisma.js";

/**
 * Trusted-device management.
 *
 * Device identity is a random, server-issued secret stored in an httpOnly cookie
 * on the client. The DB stores only an HMAC-SHA256 hash of that secret, scoped to
 * the owning user via `@@unique([userId, deviceHash])`. Identity is NEVER derived
 * from spoofable client fields (user-agent / IP) — those are retained only as
 * human-readable metadata for the "manage devices" UI.
 *
 * Security properties (A1-04):
 *   - An attacker cannot forge a victim's device hash by guessing UA + IP.
 *   - Two users behind the same NAT/UA cannot collide (the secret is random and
 *     the unique constraint is per-user).
 *   - A DB leak yields hashes, not secrets, so it cannot be used to mint trust.
 */
export class TrustedDeviceService {
  /** Generate a fresh random device secret (to be stored in the client cookie). */
  generateDeviceSecret(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /** HMAC-SHA256 the device secret, keyed by ENCRYPTION_SECRET. */
  private hashSecret(deviceSecret: string): string {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      throw new Error(
        "ENCRYPTION_SECRET environment variable is required to hash trusted-device secrets",
      );
    }
    return crypto.createHmac("sha256", secret).update(deviceSecret).digest("hex");
  }

  /**
   * Whether the presented device secret corresponds to a non-expired trusted
   * device for this user. A missing/empty secret is never trusted.
   */
  async isDeviceTrusted(userId: string, deviceSecret: string | undefined): Promise<boolean> {
    if (!deviceSecret) {
      return false;
    }
    const deviceHash = this.hashSecret(deviceSecret);

    const trustedDevice = await prisma.trustedDevice.findFirst({
      where: {
        userId,
        deviceHash,
        expiresAt: { gt: new Date() },
      },
    });

    return !!trustedDevice;
  }

  /**
   * Trust the given device secret for this user (create or refresh the record).
   * The caller is responsible for issuing/refreshing the client cookie with the
   * same `deviceSecret`.
   */
  async addTrustedDevice(
    userId: string,
    deviceSecret: string,
    metadata: { userAgent?: string; ipAddress?: string; deviceName?: string } = {},
  ): Promise<void> {
    const deviceHash = this.hashSecret(deviceSecret);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TRUSTED_DEVICE_TTL_DAYS);

    await prisma.trustedDevice.upsert({
      where: { userId_deviceHash: { userId, deviceHash } },
      create: {
        userId,
        deviceHash,
        deviceName: metadata.deviceName,
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
        expiresAt,
        lastUsedAt: new Date(),
      },
      update: {
        expiresAt,
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
        lastUsedAt: new Date(),
      },
    });
  }

  async cleanupExpiredDevices(): Promise<void> {
    await prisma.trustedDevice.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  async getUserTrustedDevices(userId: string) {
    return prisma.trustedDevice.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async removeTrustedDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.trustedDevice.deleteMany({
      where: {
        id: deviceId,
        userId,
      },
    });
  }

  async removeAllTrustedDevices(userId: string): Promise<{ count: number }> {
    const result = await prisma.trustedDevice.deleteMany({
      where: { userId },
    });
    return { count: result.count };
  }

  async updateLastUsed(userId: string, deviceSecret: string): Promise<void> {
    const deviceHash = this.hashSecret(deviceSecret);

    await prisma.trustedDevice.updateMany({
      where: { userId, deviceHash },
      data: { lastUsedAt: new Date() },
    });
  }
}
