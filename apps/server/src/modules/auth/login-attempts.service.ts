import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Record a login attempt (success or failure).
 */
export async function recordLoginAttempt(
  email: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.toLowerCase(), ipAddress, success },
  });
}

/**
 * Check if an account is locked due to too many failed attempts.
 * Returns { locked: true, remainingMinutes } or { locked: false }.
 */
export async function isAccountLocked(
  email: string,
  ipAddress: string,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  const since = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);

  const recentAttempts = await prisma.loginAttempt.findMany({
    where: {
      email: email.toLowerCase(),
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FAILED_ATTEMPTS,
  });

  // Count consecutive failures from the most recent attempt backward.
  // A success resets the count.
  const lastSuccess = recentAttempts.findIndex((a) => a.success);
  const consecutiveFailures =
    lastSuccess === -1 ? recentAttempts.filter((a) => !a.success).length : lastSuccess;

  if (consecutiveFailures >= MAX_FAILED_ATTEMPTS) {
    const oldestFailure = recentAttempts[recentAttempts.length - 1];
    const unlockAt = new Date(
      oldestFailure.createdAt.getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000,
    );
    const remainingMs = unlockAt.getTime() - Date.now();
    if (remainingMs > 0) {
      // Audit account lockout (fire-and-forget)
      logAuditEvent({
        action: "ACCOUNT_LOCKED",
        ipAddress,
        metadata: { email, remainingMinutes: Math.ceil(remainingMs / 60000) },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return {
        locked: true,
        remainingMinutes: Math.ceil(remainingMs / 60000),
      };
    }
  }

  return { locked: false };
}

/**
 * Cleanup old login attempts (run periodically).
 * Removes records older than 24 hours.
 */
export async function cleanupOldAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
