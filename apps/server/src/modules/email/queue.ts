import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { validateAllI18nKeys } from "./catalog.js";
import { emailQueueEvents } from "./events.js";
import { smtpTransport } from "./transport.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of jobs to process per batch. */
const BATCH_SIZE = 10;

/**
 * Backoff delays in seconds for each retry attempt (1-indexed by attempt count).
 * Attempt 1 → 60s, attempt 2 → 300s (5min), attempt 3 → 1800s (30min).
 */
const BACKOFF_SECONDS = [60, 300, 1800];

/**
 * Jobs in "processing" status for longer than this are considered stuck
 * and will be reset to "pending" on boot.
 */
const STUCK_JOB_TIMEOUT_MS = 5 * 60_000; // 5 minutes

/**
 * Run cleanupSentJobs() every N ticks.
 * At 30s intervals, 120 ticks ≈ 1 hour.
 */
const CLEANUP_EVERY_N_TICKS = 120;

// ─── Module state ─────────────────────────────────────────────────────────────

let currentTimeout: ReturnType<typeof setTimeout> | null = null;
let tickCount = 0;
let wakeListener: (() => void) | null = null;

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Read the poll interval from config. Re-read on every tick so live changes take effect. */
async function getIntervalMs(): Promise<number> {
  try {
    const seconds = await getConfigValue("emailQueueIntervalSeconds");
    const parsed = parseInt(seconds, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 30_000;
  } catch {
    return 30_000;
  }
}

/** Read max retries from config. Falls back to 3. */
async function _getMaxRetries(): Promise<number> {
  try {
    const value = await getConfigValue("emailQueueMaxRetries");
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  } catch {
    return 3;
  }
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Resets "processing" jobs that have been locked for longer than STUCK_JOB_TIMEOUT_MS.
 * Called once on boot to recover from crashed/killed processes.
 */
async function recoverStuckJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
  const result = await prisma.emailJob.updateMany({
    where: {
      status: "processing",
      lockedAt: { lte: cutoff },
    },
    data: {
      status: "pending",
      lockedAt: null,
    },
  });

  if (result.count > 0) {
    getLogger().info({ recoveredCount: result.count }, "Recovered stuck email jobs");
  }
}

/**
 * Deletes "sent" jobs older than `emailJobRetentionDays` days.
 * Called periodically (every CLEANUP_EVERY_N_TICKS ticks).
 */
async function cleanupSentJobs(): Promise<void> {
  let retentionDays = 30;
  try {
    const value = await getConfigValue("emailJobRetentionDays");
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      retentionDays = parsed;
    }
  } catch {
    // Use default
  }

  const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.emailJob.deleteMany({
    where: {
      status: "sent",
      sentAt: { lte: olderThan },
    },
  });

  if (result.count > 0) {
    getLogger().info(
      { deletedCount: result.count, olderThan: olderThan.toISOString() },
      "Cleaned up sent email jobs",
    );
  }
}

/**
 * Picks up a batch of pending jobs (nextAttemptAt <= now), sends each one
 * via SmtpTransport, and updates their status.
 *
 * Processing is sequential (not concurrent) — SQLite doesn't benefit from
 * parallel writes and sequential processing avoids contention.
 */
async function processBatch(): Promise<void> {
  const now = new Date();

  const jobs = await prisma.emailJob.findMany({
    where: {
      status: "pending",
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: BATCH_SIZE,
    select: {
      id: true,
      to: true,
      subject: true,
      htmlBody: true,
      textBody: true,
      listUnsubscribe: true,
      attempts: true,
      maxAttempts: true,
    },
  });

  for (const job of jobs) {
    // 1. Lock the job
    await prisma.emailJob.update({
      where: { id: job.id },
      data: {
        status: "processing",
        lockedAt: new Date(),
      },
    });

    // 2. Attempt to send
    try {
      const sendOptions: {
        to: string;
        subject: string;
        html: string;
        text: string;
        listUnsubscribeHeader?: string;
      } = {
        to: job.to,
        subject: job.subject,
        html: job.htmlBody ?? "",
        text: job.textBody ?? "",
      };

      if (job.listUnsubscribe) {
        sendOptions.listUnsubscribeHeader = job.listUnsubscribe;
      }

      await smtpTransport.sendMail(sendOptions);

      // 3. Mark sent
      await prisma.emailJob.update({
        where: { id: job.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          lockedAt: null,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newAttempts = job.attempts + 1;
      const maxAttempts = job.maxAttempts;

      getLogger().warn(
        { jobId: job.id, to: job.to, attempts: newAttempts, error: errorMessage },
        "Email send failed",
      );

      if (newAttempts >= maxAttempts) {
        // Permanently failed — no more retries
        await prisma.emailJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            attempts: newAttempts,
            lastError: errorMessage,
            lockedAt: null,
          },
        });
      } else {
        // Retry with exponential backoff
        const backoffSeconds =
          BACKOFF_SECONDS[newAttempts - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

        await prisma.emailJob.update({
          where: { id: job.id },
          data: {
            status: "pending",
            attempts: newAttempts,
            lastError: errorMessage,
            nextAttemptAt,
            lockedAt: null,
          },
        });
      }
    }
  }
}

/**
 * One scheduler tick: process batch + periodic cleanup.
 */
async function processTick(): Promise<void> {
  tickCount += 1;

  try {
    await processBatch();
  } catch (error) {
    getLogger().error({ err: error }, "Email queue processBatch failed");
  }

  // Run cleanup approximately once per hour (every CLEANUP_EVERY_N_TICKS ticks)
  if (tickCount % CLEANUP_EVERY_N_TICKS === 0) {
    try {
      await cleanupSentJobs();
    } catch (error) {
      getLogger().error({ err: error }, "Email queue cleanupSentJobs failed");
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedules the next tick using chained setTimeout.
 * Re-reads the interval from config on every schedule so live config changes
 * take effect without a server restart.
 */
async function scheduleNext(): Promise<void> {
  const intervalMs = await getIntervalMs();

  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return; // Superseded — skip

    try {
      await processTick();
    } catch (error) {
      getLogger().error({ err: error }, "Email queue tick failed");
    }

    // Chain next run only if this timer is still active
    if (currentTimeout === handle) {
      void scheduleNext();
    }
  }, intervalMs);

  currentTimeout = handle;
}

/**
 * Handler for "wake" events. Clears the current timeout and schedules
 * an immediate tick so priority jobs are processed without waiting for
 * the full interval.
 */
function onWake(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }

  // Schedule an immediate tick, then resume normal interval
  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return;

    try {
      await processTick();
    } catch (error) {
      getLogger().error({ err: error }, "Email queue wake tick failed");
    }

    if (currentTimeout === handle) {
      void scheduleNext();
    }
  }, 0);

  currentTimeout = handle;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the email queue scheduler.
 * Registers the "wake" listener and begins polling.
 */
export function startEmailQueueScheduler(): void {
  stopEmailQueueScheduler();

  // Register wake listener
  wakeListener = onWake;
  emailQueueEvents.on("wake", wakeListener);

  void scheduleNext();
  getLogger().info("Email queue scheduler started");
}

/**
 * Stop the email queue scheduler.
 * Clears the timeout and removes the wake listener.
 */
export function stopEmailQueueScheduler(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }

  if (wakeListener) {
    emailQueueEvents.off("wake", wakeListener);
    wakeListener = null;
  }
}

/**
 * Initialize the email queue on server boot.
 * Validates i18n keys, recovers stuck jobs, then starts the scheduler.
 * Fire-and-forget from server.ts — has internal error handling.
 */
export async function initEmailQueueOnBoot(): Promise<void> {
  validateAllI18nKeys();

  try {
    await recoverStuckJobs();
  } catch (error) {
    getLogger().error({ err: error }, "Failed to recover stuck email jobs on boot");
  }

  startEmailQueueScheduler();
}
