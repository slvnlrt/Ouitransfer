import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import {
  cleanupDeactivatedAccounts,
  cleanupExpiredReverseShares,
  cleanupExpiredShares,
  cleanupMaxViewsShares,
  sweepOrphans,
} from "./service.js";

// ─── Module state ─────────────────────────────────────────────────────────────

let currentTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-entrancy guard: prevents an overlapping long run from double-firing if a
 * boot run and a scheduled tick (or two scheduled ticks) would otherwise race.
 * Mirrors the `isProcessing` guard in the email queue scheduler (email/queue.ts).
 */
let isRunning = false;

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Fallback interval (hours) used when `autoCleanupIntervalHours` cannot be parsed. */
const DEFAULT_INTERVAL_HOURS = 24;

// ─── Config helpers ───────────────────────────────────────────────────────────

/**
 * Read a boolean config key. Booleans are stored as the literal strings
 * `"true"` / `"false"` (see config-validation.ts), so anything other than
 * `"true"` is treated as `false`.
 */
async function getBoolConfig(key: string): Promise<boolean> {
  const value = await getConfigValue(key);
  return value === "true";
}

/**
 * Read an integer config key with a safe fallback. All cleanup keys are seeded
 * and validated, so a parse failure should never happen in practice — but if it
 * does, log a warning and fall back to the seeded default rather than crashing
 * the run (or scheduling an absurd interval).
 */
async function getIntConfig(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    getLogger().warn(
      { key, raw, fallback },
      "Cleanup scheduler: failed to parse integer config, using fallback",
    );
    return fallback;
  }
  return parsed;
}

/**
 * Read the scheduler interval from config (hours → ms). Re-read on every
 * schedule so live config changes take effect without a server restart
 * (same approach as the email queue scheduler).
 */
async function getIntervalMs(): Promise<number> {
  try {
    const hours = await getIntConfig("autoCleanupIntervalHours", DEFAULT_INTERVAL_HOURS);
    const safeHours = hours >= 1 ? hours : DEFAULT_INTERVAL_HOURS;
    return safeHours * ONE_HOUR_MS;
  } catch (error) {
    getLogger().error(
      { err: error },
      "Cleanup scheduler: failed to read interval config, using default",
    );
    return DEFAULT_INTERVAL_HOURS * ONE_HOUR_MS;
  }
}

// ─── Core run ─────────────────────────────────────────────────────────────────

/**
 * Run the full cleanup pass once.
 *
 * All config is read fresh on every invocation so that live config changes take
 * effect without a restart. The master `autoCleanupEnabled` toggle gates the
 * content-cleanup phase (A2–A5); `accountDeactivationCleanupEnabled` (A7) and
 * `autoCleanupOrphansEnabled` (A9) are independent opt-in sub-gates.
 *
 * Each sub-call is wrapped so that one throwing does not abort the others.
 * (The cleanup functions are already failure-tolerant internally, but guarding
 * at the orchestrator level protects against an unexpected throw — e.g. a config
 * read error — leaving later phases unrun.) A re-entrancy guard ensures a slow
 * run cannot overlap with the next scheduled tick.
 */
export async function runCleanup(): Promise<void> {
  if (isRunning) {
    getLogger().debug("Cleanup scheduler: previous run still in progress, skipping this tick");
    return;
  }
  isRunning = true;

  const log = getLogger();

  // Aggregated per-run summary (one structured log line at the end).
  const summary: {
    expiredShares?: { warned: number; deleted: number; errors: number };
    maxViewsShares?: { warned: number; deleted: number; errors: number };
    expiredReverseShares?: { warned: number; deleted: number; errors: number };
    deactivatedAccounts?: { purgedAccounts: number; errors: number };
    orphans?: { dbDeleted: number; s3Deleted: number; errors: number };
  } = {};

  try {
    const enabled = await getBoolConfig("autoCleanupEnabled");

    if (!enabled) {
      log.debug("Cleanup scheduler: auto cleanup disabled, skipping run");
      return;
    }

    // ── Content cleanup (A2–A5), gated by the master toggle ──────────────────
    const graceDays = await getIntConfig("autoCleanupGracePeriodDays", 7);
    const notifyDaysBefore = await getIntConfig("autoCleanupNotifyDaysBefore", 3);
    const maxViewsDays = await getIntConfig("maxViewsCleanupDays", 30);

    try {
      summary.expiredShares = await cleanupExpiredShares({ graceDays, notifyDaysBefore });
    } catch (error) {
      log.error({ err: error }, "Cleanup scheduler: cleanupExpiredShares failed");
    }

    try {
      summary.maxViewsShares = await cleanupMaxViewsShares({ inactiveDays: maxViewsDays });
    } catch (error) {
      log.error({ err: error }, "Cleanup scheduler: cleanupMaxViewsShares failed");
    }

    try {
      summary.expiredReverseShares = await cleanupExpiredReverseShares({
        graceDays,
        notifyDaysBefore,
      });
    } catch (error) {
      log.error({ err: error }, "Cleanup scheduler: cleanupExpiredReverseShares failed");
    }

    // ── Deactivated-account file cleanup (A7), independent opt-in gate ────────
    if (await getBoolConfig("accountDeactivationCleanupEnabled")) {
      try {
        const days = await getIntConfig("accountDeactivationCleanupDays", 30);
        summary.deactivatedAccounts = await cleanupDeactivatedAccounts({ days });
      } catch (error) {
        log.error({ err: error }, "Cleanup scheduler: cleanupDeactivatedAccounts failed");
      }
    }

    // ── Orphan sweep (A9), independent opt-in gate ───────────────────────────
    if (await getBoolConfig("autoCleanupOrphansEnabled")) {
      try {
        const minAgeHours = await getIntConfig("autoCleanupOrphanMinAgeHours", 24);
        summary.orphans = await sweepOrphans({ minAgeHours });
      } catch (error) {
        log.error({ err: error }, "Cleanup scheduler: sweepOrphans failed");
      }
    }

    log.info({ summary }, "Cleanup run completed");
  } catch (error) {
    log.error({ err: error }, "Cleanup run failed");
  } finally {
    isRunning = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedule the next cleanup run using chained setTimeout (not setInterval).
 * Re-reads the interval from config on every schedule so live config changes
 * take effect without a restart — same idiom as the email queue scheduler.
 */
async function scheduleNext(): Promise<void> {
  const intervalMs = await getIntervalMs();

  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return; // Superseded — skip

    await runCleanup();

    // Chain next run only if this timer is still active
    if (currentTimeout === handle) {
      void scheduleNext();
    }
  }, intervalMs);

  currentTimeout = handle;
}

/**
 * Start the cleanup scheduler.
 */
export function startCleanupScheduler(): void {
  stopCleanupScheduler();
  void scheduleNext();
  getLogger().info("Cleanup scheduler started");
}

/**
 * Stop the cleanup scheduler.
 */
export function stopCleanupScheduler(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
}

/**
 * Initialize the cleanup scheduler on server boot.
 * Runs an immediate first pass so expired content is not left lingering for up
 * to a full interval after a restart, then starts the recurring scheduler.
 */
export async function initCleanupOnBoot(): Promise<void> {
  try {
    await runCleanup();
  } catch (error) {
    getLogger().error({ err: error }, "Initial cleanup run failed");
  }

  startCleanupScheduler();
}
