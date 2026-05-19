import { getLogger } from "../../utils/logger.js";
import { LdapConfigRepository } from "./config.repository.js";
import { LdapSyncService } from "./sync.service.js";

let currentInterval: ReturnType<typeof setInterval> | null = null;
let schedulerNextSyncAt: Date | null = null;

const syncService = new LdapSyncService();
const configRepository = new LdapConfigRepository();

/**
 * Start the sync scheduler with the given interval.
 * Clears any existing scheduler first.
 */
export function startScheduler(intervalMinutes: number): void {
  stopScheduler();
  const intervalMs = intervalMinutes * 60 * 1000;
  schedulerNextSyncAt = new Date(Date.now() + intervalMs);

  currentInterval = setInterval(async () => {
    try {
      await syncService.runSync("scheduled");
    } catch (error) {
      getLogger().error({ err: error }, "Scheduled LDAP sync failed");
    }
    schedulerNextSyncAt = new Date(Date.now() + intervalMs);
  }, intervalMs);
}

/**
 * Stop the sync scheduler.
 */
export function stopScheduler(): void {
  if (currentInterval) {
    clearInterval(currentInterval);
    currentInterval = null;
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
 * Check if the scheduler is currently running.
 */
export function isSchedulerRunning(): boolean {
  return currentInterval !== null;
}

/**
 * Initialize the scheduler on server boot.
 * Checks if LDAP is configured and enabled, starts scheduler if so.
 */
export async function initSchedulerOnBoot(): Promise<void> {
  try {
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
