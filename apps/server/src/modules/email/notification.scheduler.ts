import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { emailService } from "./service.js";
import { buildShareManageUrl } from "./url-builder.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Number of days before expiration to send the "expiring" notification.
 * Will be made configurable in feature 5.2.
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
      await emailService.send("share_expiring", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        shareId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          expiresAt: share.expiration.toISOString(),
          shareManageUrl,
        },
      });
      await prisma.share.update({
        where: { id: share.id },
        data: { notifiedForExpiring: true },
      });
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
      await emailService.send("share_expired", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        shareId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          expiredAt: share.expiration.toISOString(),
          shareManageUrl,
        },
      });
      await prisma.share.update({
        where: { id: share.id },
        data: { notifiedForExpired: true },
      });
    } catch (err) {
      getLogger().error({ err, shareId: share.id }, "Failed to send share_expired notification");
    }
  }
}

/**
 * Send share_no_activity notifications for shares that have exceeded their
 * inactivity threshold without any downloads.
 */
async function checkInactiveShares(): Promise<void> {
  const now = new Date();

  // Fetch all shares with inactivity alerts configured that haven't been sent yet
  const shares = await prisma.share.findMany({
    where: {
      inactivityAlertDays: { not: null },
      inactivityAlertSent: false,
      creatorId: { not: null },
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
      await emailService.send("share_no_activity", {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        shareId: share.id,
        data: {
          shareName: share.name ?? "Unnamed share",
          inactivityDays: share.inactivityAlertDays,
          shareManageUrl,
        },
      });
      await prisma.share.update({
        where: { id: share.id },
        data: { inactivityAlertSent: true },
      });
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
      await emailService.send("reverse_share_expiring", {
        to: rs.creator.email,
        locale: rs.creator.locale ?? "en",
        userId: rs.creatorId,
        data: {
          reverseShareName: rs.name ?? "Unnamed reverse share",
          expiresAt: rs.expiration.toISOString(),
        },
      });
      await prisma.reverseShare.update({
        where: { id: rs.id },
        data: { notifiedForExpiring: true },
      });
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
      await emailService.send("reverse_share_expired", {
        to: rs.creator.email,
        locale: rs.creator.locale ?? "en",
        userId: rs.creatorId,
        data: {
          reverseShareName: rs.name ?? "Unnamed reverse share",
          expiredAt: rs.expiration.toISOString(),
        },
      });
      await prisma.reverseShare.update({
        where: { id: rs.id },
        data: { notifiedForExpired: true },
      });
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
 * Schedule the next notification check.
 * Uses chained setTimeout (not setInterval) to prevent overlapping runs.
 *
 * DESIGN LIMITATION: The scheduler runs at boot + N × 24h intervals.
 * This means notification timing depends on when the server started.
 * Wall-clock alignment (e.g., always run at 9am local time) would require
 * computing the delta to the next target hour via setTimeout. This is
 * acceptable for the current single-instance deployment but should be
 * revisited if user-facing timing guarantees are added.
 */
function scheduleNext(): void {
  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return; // Superseded — skip

    try {
      await runAllChecks();
    } catch (err) {
      getLogger().error({ err }, "Notification scheduler run failed");
    }

    // Chain next run only if this timer is still active
    if (currentTimeout === handle) {
      scheduleNext();
    }
  }, ONE_DAY_MS);

  currentTimeout = handle;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the notification scheduler.
 */
export function startNotificationScheduler(): void {
  stopNotificationScheduler();
  scheduleNext();
  getLogger().info("Notification scheduler started (daily)");
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
 * Design: the scheduler checks once at boot (crash recovery / catch-up) + every 24h via
 * chained setTimeout. The boot-time run is safe because each check is idempotent — it
 * filters on `notifiedForExpiring: false` / `notifiedForExpired: false` and marks the
 * flag true after sending, so duplicate runs are no-ops. Wall-clock alignment to a
 * specific hour (e.g. `emailDigestHour`) is a future enhancement.
 */
export async function initNotificationSchedulerOnBoot(): Promise<void> {
  try {
    // Run initial check on boot
    try {
      await runAllChecks();
      getLogger().info("Notification scheduler initial check completed");
    } catch (err) {
      getLogger().error({ err }, "Initial notification check failed");
    }

    startNotificationScheduler();
  } catch (err) {
    getLogger().error({ err }, "Failed to initialize notification scheduler");
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
