import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Dedicated, lower failure ceiling for the standalone 2FA-verification endpoint
 * (`POST /2fa/verify`, A1-02). A 6-digit TOTP has a small enough space that the
 * step-up path warrants a tighter brake than the credential login path. Because
 * both paths share the email-keyed `LoginAttempt` table, this lower threshold
 * trips first for 2FA-verify failures.
 */
const MAX_2FA_VERIFY_ATTEMPTS = 5;

/**
 * Per-IP failed-login throttle (A1-01). Complements the email-only lockout: the
 * email lockout resists IP rotation for a single account, but does nothing to
 * brake credential-stuffing that spreads ONE guess across many different emails
 * from a single source IP. This throttle counts failures from a single IP across
 * ALL emails within the window and locks that IP out once the ceiling is hit.
 *
 * The threshold is deliberately higher than the per-email one: many legitimate
 * users can share one egress IP (corporate NAT), so the IP brake must only trip
 * on volumes that no honest shared network would plausibly produce.
 */
const MAX_FAILED_ATTEMPTS_PER_IP = 30;
const IP_THROTTLE_DURATION_MINUTES = 15;

/**
 * IPs for which the throttle is disabled. An absent/unknown IP (e.g. a
 * misconfigured proxy that yields no address) must not throttle every client, so
 * it is treated as non-throttleable.
 */
const NON_THROTTLEABLE_IPS = new Set(["", "unknown"]);

/**
 * Normalize an email address for consistent storage and lookup.
 * Trim whitespace and lowercase so "User@Example.com " matches "user@example.com".
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Record a login attempt (success or failure).
 *
 * Skips recording if the account is already locked. This prevents a "rolling
 * lockout" where subsequent blocked requests push the oldest attempt out of
 * the window, indefinitely extending the lockout beyond the intended duration.
 * The lockout should expire based on the LAST real attempt, not be extended
 * by subsequent rejected requests.
 *
 * Successful attempts are always recorded to reset the lockout counter.
 */
export async function recordLoginAttempt(
  email: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  // If it's a failure, check if the account is already locked before recording.
  // Successful logins always get recorded (they reset the failure counter).
  //
  // Defense-in-depth: callers (login controller, 2FA controller) typically check
  // isAccountLocked themselves before attempting authentication, so this guard
  // is usually a no-op. It is kept here to protect against any future call sites
  // that skip the pre-check, and to enforce the "rolling lockout prevention"
  // invariant regardless of how recordLoginAttempt is invoked.
  if (!success) {
    const { locked } = await isAccountLocked(email, ipAddress);
    if (locked) {
      return; // Don't record — the lockout window is already in effect
    }
  }

  await prisma.loginAttempt.create({
    data: { email: normalizeEmail(email), ipAddress, success },
  });
}

/**
 * Check if an account is locked due to too many failed attempts.
 * Returns { locked: true, remainingMinutes } or { locked: false }.
 *
 * **Lockout is intentionally email-only** — the decision is based solely on
 * the `email` parameter, not on `ipAddress`. This is a deliberate design choice:
 *
 * - `ipAddress` is accepted as a parameter and forwarded to the audit log so
 *   that administrators can correlate lockout events with specific IP addresses,
 *   but it plays no role in the lockout calculation itself.
 *
 * - Email-only lockout prevents IP-rotation attacks: an attacker who changes
 *   their IP address between attempts would bypass an IP-based lockout, but
 *   cannot escape an email-based one.
 *
 * The trade-off is that a malicious actor can trigger a lockout for a target
 * account (denial-of-service against a single user). This is accepted as a
 * lesser risk than allowing unlimited credential-stuffing through IP rotation.
 */
export async function isAccountLocked(
  email: string,
  ipAddress: string,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  return evaluateEmailLockout(email, ipAddress, MAX_FAILED_ATTEMPTS);
}

/**
 * Like {@link isAccountLocked} but with the dedicated, lower 2FA-verify ceiling
 * (A1-02). Used by the standalone `POST /2fa/verify` step-up endpoint so that
 * online TOTP/backup-code brute force is braked independently of (and sooner
 * than) the credential-login lockout.
 */
export async function is2faVerifyLocked(
  email: string,
  ipAddress: string,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  return evaluateEmailLockout(email, ipAddress, MAX_2FA_VERIFY_ATTEMPTS);
}

/**
 * Shared email-keyed lockout evaluation. Counts consecutive failures (a success
 * resets the count) within the window and reports locked once `threshold` is
 * reached. The IP is forwarded to the audit log only — it never participates in
 * the lockout decision (see the email-only rationale above).
 */
async function evaluateEmailLockout(
  email: string,
  ipAddress: string,
  threshold: number,
): Promise<{ locked: boolean; remainingMinutes?: number }> {
  const since = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);

  const recentAttempts = await prisma.loginAttempt.findMany({
    where: {
      email: normalizeEmail(email),
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: threshold,
  });

  // Count consecutive failures from the most recent attempt backward.
  // A success resets the count.
  const lastSuccess = recentAttempts.findIndex((a) => a.success);
  const consecutiveFailures =
    lastSuccess === -1 ? recentAttempts.filter((a) => !a.success).length : lastSuccess;

  if (consecutiveFailures >= threshold) {
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
 * Check whether a single source IP has exceeded the per-IP failed-login ceiling
 * within the throttle window (A1-01). This is independent of the per-email
 * lockout and is keyed solely on `ipAddress` (across all emails).
 *
 * Returns { throttled: true, remainingMinutes } when the IP is throttled.
 */
export async function isIpThrottled(
  ipAddress: string,
): Promise<{ throttled: boolean; remainingMinutes?: number }> {
  if (NON_THROTTLEABLE_IPS.has(ipAddress)) {
    return { throttled: false };
  }

  const since = new Date(Date.now() - IP_THROTTLE_DURATION_MINUTES * 60 * 1000);

  const recentFailures = await prisma.loginAttempt.findMany({
    where: {
      ipAddress,
      success: false,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FAILED_ATTEMPTS_PER_IP,
  });

  if (recentFailures.length < MAX_FAILED_ATTEMPTS_PER_IP) {
    return { throttled: false };
  }

  // The window's oldest counted failure determines when the throttle lifts.
  const oldestFailure = recentFailures[recentFailures.length - 1];
  const unlockAt = new Date(
    oldestFailure.createdAt.getTime() + IP_THROTTLE_DURATION_MINUTES * 60 * 1000,
  );
  const remainingMs = unlockAt.getTime() - Date.now();
  if (remainingMs <= 0) {
    return { throttled: false };
  }

  logAuditEvent({
    action: "LOGIN_IP_THROTTLED",
    ipAddress,
    metadata: { remainingMinutes: Math.ceil(remainingMs / 60000) },
  }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

  return { throttled: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
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
