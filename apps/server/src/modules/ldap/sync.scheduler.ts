import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { LdapConfigRepository } from "./config.repository.js";
import { LdapSyncService } from "./sync.service.js";

let currentTimeout: ReturnType<typeof setTimeout> | null = null;
let schedulerNextSyncAt: Date | null = null;

const syncService = new LdapSyncService();
const configRepository = new LdapConfigRepository();

/**
 * Schedule the next sync after the given interval.
 * Uses chained setTimeout (not setInterval) so overlapping syncs are impossible.
 *
 * Race-condition guard: the handle captured at schedule time is compared inside
 * the callback to detect superseded timers (e.g. when scheduleNext is called
 * again before the previous timer fires).
 */
function scheduleNext(intervalMs: number): void {
  schedulerNextSyncAt = new Date(Date.now() + intervalMs);
  const handle = setTimeout(async () => {
    // If currentTimeout no longer points to this handle, a newer timer was
    // registered — skip execution to avoid a stale fire.
    if (currentTimeout !== handle) {
      return;
    }

    // Sync is starting: clear the "next sync" time while running.
    schedulerNextSyncAt = null;

    try {
      await syncService.runSync("scheduled");
    } catch (error) {
      getLogger().error({ err: error }, "Scheduled LDAP sync failed");
    }

    // Chain next sync only if this timer is still the active one (scheduler
    // hasn't been stopped or restarted during the sync).
    if (currentTimeout === handle) {
      scheduleNext(intervalMs);
    }
  }, intervalMs);
  currentTimeout = handle;
}

/**
 * Start the sync scheduler with the given interval.
 * Clears any existing scheduler first.
 */
export function startScheduler(intervalMinutes: number): void {
  stopScheduler();
  const intervalMs = intervalMinutes * 60 * 1000;
  scheduleNext(intervalMs);
}

/**
 * Stop the sync scheduler.
 */
export function stopScheduler(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
    schedulerNextSyncAt = null;
  }
}

/**
 * Get the next scheduled sync time, or null if scheduler is not running.
 */
export function getNextSyncAt(): Date | null {
  return schedulerNextSyncAt;
}

/**
 * Initialize the scheduler on server boot.
 * Checks if LDAP is configured and enabled, starts scheduler if so.
 * Also cleans up stale "running" sync logs from previous crashes.
 */
export async function initSchedulerOnBoot(): Promise<void> {
  try {
    // Clean up ALL stale "running" logs from crashed/restarted syncs.
    // No time-based cutoff: any "running" log on boot is by definition stale.
    await prisma.ldapSyncLog.updateMany({
      where: { status: "running" },
      data: {
        status: "error",
        completedAt: new Date(),
        details: JSON.stringify([
          {
            type: "error",
            username: "",
            phase: "boot-recovery",
            message: "Sync interrupted by server restart",
          },
        ]),
      },
    });

    const config = await configRepository.get();
    if (config?.enabled) {
      startScheduler(config.syncIntervalMinutes);
      getLogger().info(
        { intervalMinutes: config.syncIntervalMinutes },
        "LDAP sync scheduler started",
      );
    }
  } catch (error) {
    getLogger().error({ err: error }, "Failed to initialize LDAP scheduler");
  }
}

export { syncService };
