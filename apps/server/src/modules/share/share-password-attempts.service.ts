import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import type { AuditAction } from "../audit/service.js";
import { logAuditEvent } from "../audit/service.js";

/**
 * Per-share password brute-force protection (R2 — A4-03).
 *
 * Share and reverse-share password gates are public (anonymous, csrfExempt) and historically
 * relied only on the global per-IP rate limit — there was no per-share attempt counter, so an
 * attacker could brute-force a share password by rotating IPs, and the quieter download-path
 * password check emitted no audit at all.
 *
 * This module adds a progressive lockout keyed by the SHARE (not the IP), reusing the existing
 * `LoginAttempt` table — a generic attempt log — with a namespaced key in its `email` column
 * (`share:<id>` / `rshare:<id>`). Keying by share (like the email-only login lockout) defeats
 * IP rotation; the 24h `cleanupOldAttempts` sweep already prunes these rows.
 *
 * Threshold is tighter than the login lockout (5 vs 10): share passwords are often short/weak,
 * the surface is fully anonymous, and there is no legitimate reason for a single share to see
 * many consecutive failures.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export type ShareKind = "share" | "reverse-share";

function lockKey(kind: ShareKind, shareId: string): string {
  return `${kind === "share" ? "share" : "rshare"}:${shareId}`;
}

function lockedAuditAction(kind: ShareKind): AuditAction {
  return kind === "share" ? "SHARE_PASSWORD_LOCKED" : "REVERSE_SHARE_PASSWORD_LOCKED";
}

/**
 * Record a share password attempt. Skips recording failures while already locked to avoid a
 * "rolling lockout" (matching the login-attempt machinery's invariant). Successes are always
 * recorded — they reset the failure counter.
 */
export async function recordSharePasswordAttempt(
  kind: ShareKind,
  shareId: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  if (!success) {
    const { locked } = await isSharePasswordLocked(kind, shareId, ipAddress);
    if (locked) return;
  }
  await prisma.loginAttempt.create({
    data: { email: lockKey(kind, shareId), ipAddress, success },
  });
}

/**
 * Check whether a share's password gate is currently locked due to too many consecutive failed
 * attempts. Decision is share-keyed (IP is audit-only), mirroring the email-only login lockout
 * so IP rotation cannot bypass it.
 */
export async function isSharePasswordLocked(
  kind: ShareKind,
  shareId: string,
  ipAddress: string,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  const since = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);
  const key = lockKey(kind, shareId);

  const recentAttempts = await prisma.loginAttempt.findMany({
    where: { email: key, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: MAX_FAILED_ATTEMPTS,
  });

  // Count consecutive failures from the most recent backward; a success resets the count.
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
      logAuditEvent({
        action: lockedAuditAction(kind),
        ipAddress,
        targetType: kind === "share" ? "share" : "reverse_share",
        targetId: shareId,
        metadata: { remainingMinutes: Math.ceil(remainingMs / 60000) },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
      return { locked: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
    }
  }

  return { locked: false };
}
