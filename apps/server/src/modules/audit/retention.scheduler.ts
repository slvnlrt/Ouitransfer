import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { deleteOldAuditLogs, logAuditEvent } from "./service.js";

let currentTimeout: ReturnType<typeof setTimeout> | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule the next retention cleanup.
 * Uses chained setTimeout (not setInterval) — same pattern as LDAP scheduler.
 */
function scheduleNext(): void {
  const handle = setTimeout(async () => {
    if (currentTimeout !== handle) return; // Superseded — skip

    try {
      const retentionDaysStr = await getConfigValue("auditRetentionDays");
      const retentionDays = parseInt(retentionDaysStr, 10);

      if (retentionDays > 0) {
        const olderThan = new Date(Date.now() - retentionDays * ONE_DAY_MS);
        const deletedCount = await deleteOldAuditLogs(olderThan);

        if (deletedCount > 0) {
          getLogger().info(
            { deletedCount, olderThan: olderThan.toISOString() },
            "Audit retention cleanup completed",
          );

          // Log the cleanup as an audit event itself
          logAuditEvent({
            action: "AUDIT_RETENTION_CLEANUP",
            ipAddress: "system",
            metadata: {
              deletedCount,
              olderThan: olderThan.toISOString(),
            },
          }).catch((err) => {
            getLogger().error({ err }, "Failed to log audit retention cleanup event");
          });
        }
      }
    } catch (error) {
      getLogger().error({ err: error }, "Audit retention cleanup failed");
    }

    // Chain next run only if this timer is still active
    if (currentTimeout === handle) {
      scheduleNext();
    }
  }, ONE_DAY_MS);

  currentTimeout = handle;
}

/**
 * Start the audit retention scheduler.
 */
export function startAuditRetentionScheduler(): void {
  stopAuditRetentionScheduler();
  scheduleNext();
  getLogger().info("Audit retention scheduler started (daily)");
}

/**
 * Stop the audit retention scheduler.
 */
export function stopAuditRetentionScheduler(): void {
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
}

/**
 * Initialize audit retention on server boot.
 * Also verifies WAL mode and runs an immediate first cleanup so records
 * are not left stale for up to 24 hours after a restart.
 */
export async function initAuditRetentionOnBoot(): Promise<void> {
  try {
    // Verify WAL mode
    const result = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    const journalMode = result[0]?.journal_mode;
    if (journalMode !== "wal") {
      getLogger().warn(
        { journalMode },
        "SQLite is NOT in WAL mode. Audit write volume may cause contention. " +
          "Set journal_mode=WAL in your migration or deployment config.",
      );
    }

    // Run initial cleanup on boot so expired records don't linger up to 24h (FIX C-4)
    try {
      const retentionDaysStr = await getConfigValue("auditRetentionDays");
      const retentionDays = parseInt(retentionDaysStr, 10);
      if (retentionDays > 0) {
        const olderThan = new Date(Date.now() - retentionDays * ONE_DAY_MS);
        const deletedCount = await deleteOldAuditLogs(olderThan);
        if (deletedCount > 0) {
          getLogger().info({ deletedCount }, "Audit retention initial cleanup completed");
          logAuditEvent({
            action: "AUDIT_RETENTION_CLEANUP",
            ipAddress: "system",
            metadata: { deletedCount, olderThan: olderThan.toISOString() },
          }).catch((err) => {
            getLogger().error({ err }, "Failed to log audit retention cleanup event");
          });
        }
      }
    } catch (error) {
      getLogger().error({ err: error }, "Initial audit retention cleanup failed");
    }

    startAuditRetentionScheduler();
  } catch (error) {
    getLogger().error({ err: error }, "Failed to initialize audit retention scheduler");
  }
}
