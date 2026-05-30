import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { emailService } from "../email/service.js";
import { buildShareManageUrl } from "../email/url-builder.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Number of days before expiration to send the "expiring" notification.
 * TODO: Make configurable via a `shareExpiryWarnDays` config key (default 3).
 * Depends on 5.2 (Lifecycle & Cleanup) which adds the config infrastructure
 * for cleanup-related settings. Until then, this is a hardcoded default.
 */
const EXPIRY_WARN_DAYS = 3;

// ─── Module state ─────────────────────────────────────────────────────────────

let currentTimeout: ReturnType<typeof setTimeout> | null = null;

// ─── Checks ───────────────────────────────────────────────────────────────────

/**
 * Send share_expiring notifications for shares whose expiration is within
 * EXPIRY_WARN_DAYS from now and have not yet been notified.
 */
async function checkExpiringShares(): Promise<void> {
  const now = new Date();
  const warnThreshold = new Date(now.getTime() + EXPIRY_WARN_DAYS * ONE_DAY_MS);

  const shares = await prisma.share.findMany({
    where: {
      expiration: {
        not: null,
        gt: now,
        lt: warnThreshold,
      },
      notifiedForExpiring: false,
      creatorId: { not: null },
      creator: { isActive: true },
    },
    include: {
      creator: {
        select: { id: true, email: true, locale: true },
      },
    },
  });

  // TODO: Performance — batch updateMany after processing. Current sequential
  // per-share approach is fine for typical deployments (< 1000 active shares).
  // For large deployments, collect successful IDs and use a single
  // prisma.share.updateMany({ where: { id: { in: ids } }, data: { notifiedForExpiring: true } }).
  for (const share of shares) {
    if (!share.creator || !share.creatorId) continue;
    if (!share.expiration) continue;
    try {
      const shareManageUrl = await buildShareManageUrl(share.id);
      const result = await emailService.send("share_expiring", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        relatedId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          expiresAt: share.expiration.toISOString(),
          shareManageUrl,
        },
      });
      if (result.enqueued) {
        await prisma.share.update({
          where: { id: share.id },
          data: { notifiedForExpiring: true },
        });
      }
    } catch (err) {
      getLogger().error({ err, shareId: share.id }, "Failed to send share_expiring notification");
    }
  }
}

/**
 * Send share_expired notifications for shares that have already expired
 * and have not yet been notified.
 */
async function checkExpiredShares(): Promise<void> {
  const now = new Date();

  const shares = await prisma.share.findMany({
    where: {
      expiration: {
        not: null,
        lt: now,
      },
      notifiedForExpired: false,
      creatorId: { not: null },
      creator: { isActive: true },
    },
    include: {
      creator: {
        select: { id: true, email: true, locale: true },
      },
    },
  });

  for (const share of shares) {
    if (!share.creator || !share.creatorId) continue;
    if (!share.expiration) continue;
    try {
      const shareManageUrl = await buildShareManageUrl(share.id);
      const result = await emailService.send("share_expired", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        relatedId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          expiredAt: share.expiration.toISOString(),
          shareManageUrl,
        },
      });
      if (result.enqueued) {
        await prisma.share.update({
          where: { id: share.id },
          data: { notifiedForExpired: true },
        });
      }
    } catch (err) {
      getLogger().error({ err, shareId: share.id }, "Failed to send share_expired notification");
    }
  }
}

/**
 * Send share_no_activity notifications for shares that have exceeded their
 * inactivity threshold without any downloads.
 *
 * Alert lifecycle: when a non-owner downloads a share, `trackShareDownload()` resets
 * `inactivityAlertSent` to `false` and updates `lastDownloadedAt`, allowing a future
 * alert cycle if the share goes inactive again.
 *
 * PERF NOTE: This fetches all shares with inactivityAlertDays set and filters in JS.
 * For large deployments (10k+ shares), consider using prisma.$queryRaw with a computed
 * WHERE clause.
 */
async function checkInactiveShares(): Promise<void> {
  const now = new Date();

  // Fetch all shares with inactivity alerts configured that haven't been sent yet
  const shares = await prisma.share.findMany({
    where: {
      inactivityAlertDays: { not: null },
      inactivityAlertSent: false,
      creatorId: { not: null },
      creator: { isActive: true },
    },
    include: {
      creator: {
        select: { id: true, email: true, locale: true },
      },
    },
  });

  for (const share of shares) {
    if (!share.creator || !share.creatorId || share.inactivityAlertDays === null) continue;

    const threshold = new Date(now.getTime() - share.inactivityAlertDays * ONE_DAY_MS);
    const isInactive =
      (share.lastDownloadedAt === null && share.createdAt < threshold) ||
      (share.lastDownloadedAt !== null && share.lastDownloadedAt < threshold);

    if (!isInactive) continue;

    try {
      const shareManageUrl = await buildShareManageUrl(share.id);
      const result = await emailService.send("share_no_activity", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        relatedId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          inactivityDays: share.inactivityAlertDays,
          shareManageUrl,
        },
      });
      if (result.enqueued) {
        await prisma.share.update({
          where: { id: share.id },
          data: { inactivityAlertSent: true },
        });
      }
    } catch (err) {
      getLogger().error(
        { err, shareId: share.id },
        "Failed to send share_no_activity notification",
      );
    }
  }
}

/**
 * Send reverse_share_expiring notifications for reverse shares whose expiration
 * is within EXPIRY_WARN_DAYS from now and have not yet been notified.
 */
async function checkExpiringReverseShares(): Promise<void> {
  const now = new Date();
  const warnThreshold = new Date(now.getTime() + EXPIRY_WARN_DAYS * ONE_DAY_MS);

  const reverseShares = await prisma.reverseShare.findMany({
    where: {
      expiration: {
        not: null,
        gt: now,
        lt: warnThreshold,
      },
      notifiedForExpiring: false,
      creator: { isActive: true },
    },
    include: {
      creator: {
        select: { id: true, email: true, locale: true },
      },
    },
  });

  for (const rs of reverseShares) {
    if (!rs.expiration) continue;
    try {
      const result = await emailService.send("reverse_share_expiring", {
        to: rs.creator.email,
        locale: rs.creator.locale ?? "en",
        userId: rs.creatorId,
        data: {
          reverseShareName: rs.name ?? "Unnamed reverse share",
          expiresAt: rs.expiration.toISOString(),
        },
      });
      if (result.enqueued) {
        await prisma.reverseShare.update({
          where: { id: rs.id },
          data: { notifiedForExpiring: true },
        });
      }
    } catch (err) {
      getLogger().error(
        { err, reverseShareId: rs.id },
        "Failed to send reverse_share_expiring notification",
      );
    }
  }
}

/**
 * Send reverse_share_expired notifications for reverse shares that have expired.
 */
async function checkExpiredReverseShares(): Promise<void> {
  const now = new Date();

  const reverseShares = await prisma.reverseShare.findMany({
    where: {
      expiration: {
        not: null,
        lt: now,
      },
      notifiedForExpired: false,
      creator: { isActive: true },
    },
    include: {
      creator: {
        select: { id: true, email: true, locale: true },
      },
    },
  });

  for (const rs of reverseShares) {
    if (!rs.expiration) continue;
    try {
      const result = await emailService.send("reverse_share_expired", {
        to: rs.creator.email,
        locale: rs.creator.locale ?? "en",
        userId: rs.creatorId,
        data: {
          reverseShareName: rs.name ?? "Unnamed reverse share",
          expiredAt: rs.expiration.toISOString(),
        },
      });
      if (result.enqueued) {
        await prisma.reverseShare.update({
          where: { id: rs.id },
          data: { notifiedForExpired: true },
        });
      }
    } catch (err) {
      getLogger().error(
        { err, reverseShareId: rs.id },
        "Failed to send reverse_share_expired notification",
      );
    }
  }
}

// ─── Scheduler core ───────────────────────────────────────────────────────────

/**
 * Run all notification checks once.
 */
async function runAllChecks(): Promise<void> {
  const log = getLogger();

  try {
    await checkExpiringShares();
  } catch (err) {
    log.error({ err }, "checkExpiringShares failed");
  }

  try {
    await checkExpiredShares();
  } catch (err) {
    log.error({ err }, "checkExpiredShares failed");
  }

  try {
    await checkInactiveShares();
  } catch (err) {
    log.error({ err }, "checkInactiveShares failed");
  }

  try {
    await checkExpiringReverseShares();
  } catch (err) {
    log.error({ err }, "checkExpiringReverseShares failed");
  }

  try {
    await checkExpiredReverseShares();
  } catch (err) {
    log.error({ err }, "checkExpiredReverseShares failed");
  }
}

/**
 * Returns the configured notification check hour (0–23, UTC). Defaults to 8
 * if not set or invalid.
 *
 * Reads `notificationCheckHour` first, falling back to `emailDigestHour`
 * for backward compatibility, then to the hardcoded default of 8.
 */
async function getNotificationCheckHourUtc(): Promise<number> {
  // Try dedicated config key first
  try {
    const value = await getConfigValue("notificationCheckHour");
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) {
      return parsed;
    }
  } catch {
    // Config key not found — try fallback
  }
  // Fall back to emailDigestHour (backward compatibility)
  try {
    const value = await getConfigValue("emailDigestHour");
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) {
      return parsed;
    }
  } catch {
    // Config key not found — use default
  }
  return 8;
}

/**
 * Computes the milliseconds until the next occurrence of `targetHour:00 UTC`.
 * If the target hour has already passed today, returns the ms until that hour
 * tomorrow. The result is always > 0.
 */
export function msUntilNextUtcHour(targetHour: number, now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);

  // If the target hour has already passed today, move to tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Schedule the next notification check at the configured check hour (UTC).
 * Uses chained setTimeout (not setInterval) to prevent overlapping runs.
 *
 * The first tick is wall-clock aligned to the configured hour (UTC), then
 * subsequent ticks run every 24h from that point. This ensures consistent
 * daily timing regardless of when the server was (re)started.
 */
async function scheduleNext(delayMs?: number): Promise<void> {
  let delay: number;
  if (delayMs !== undefined) {
    delay = delayMs;
  } else {
    const checkHour = await getNotificationCheckHourUtc();
    delay = msUntilNextUtcHour(checkHour);
  }

  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return; // Superseded — skip

    try {
      await runAllChecks();
    } catch (err) {
      getLogger().error({ err }, "Notification scheduler run failed");
    }

    // Chain next run at the next digest hour (24h from now, re-computed for drift correction)
    if (currentTimeout === handle) {
      void scheduleNext();
    }
  }, delay);

  currentTimeout = handle;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the notification scheduler.
 * Computes the delay until the next `emailDigestHour:00 UTC` and schedules
 * the first tick at that time.
 */
export async function startNotificationScheduler(): Promise<void> {
  stopNotificationScheduler();
  const checkHour = await getNotificationCheckHourUtc();
  await scheduleNext();
  getLogger().info(
    `Notification scheduler started — next run aligned to ${String(checkHour).padStart(2, "0")}:00 UTC`,
  );
}

/**
 * Stop the notification scheduler.
 */
export function stopNotificationScheduler(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
}

/**
 * Initialize the notification scheduler on server boot.
 * Runs an immediate first check so notifications are not delayed up to 24h after a restart.
 *
 * Design: the scheduler checks once at boot (crash recovery / catch-up) + daily at
 * `emailDigestHour:00 UTC` via chained setTimeout. The boot-time run is safe because
 * each check is idempotent — it filters on `notifiedForExpiring: false` /
 * `notifiedForExpired: false` and marks the flag true after sending, so duplicate
 * runs are no-ops.
 */
export async function initNotificationSchedulerOnBoot(): Promise<void> {
  const log = getLogger();

  // Run initial check on boot with retry for transient DB errors.
  // Backoff: 30s, 60s, 120s. If all 3 attempts fail, log an error and
  // continue with the scheduled timer — the first scheduled run will retry.
  const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

  let bootCheckSucceeded = false;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await runAllChecks();
      const checkHour = await getNotificationCheckHourUtc();
      log.info(
        `Notification scheduler boot check completed — next scheduled run aligned to ${String(checkHour).padStart(2, "0")}:00 UTC`,
      );
      bootCheckSucceeded = true;
      break;
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        log.warn(
          { err, attempt: attempt + 1, nextRetryMs: delayMs },
          "Boot-time notification check failed, retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        log.error(
          { err, attempts: attempt + 1 },
          "Boot-time notification check failed after all retries — continuing with scheduled timer",
        );
      }
    }
  }

  try {
    await startNotificationScheduler();
    if (!bootCheckSucceeded) {
      log.info("Notification scheduler started (boot check failed, relying on scheduled runs)");
    }
  } catch (err) {
    log.error({ err }, "Failed to start notification scheduler");
  }
}

// ─── Exported for testing ─────────────────────────────────────────────────────

export {
  checkExpiredReverseShares,
  checkExpiredShares,
  checkExpiringReverseShares,
  checkExpiringShares,
  checkInactiveShares,
};
