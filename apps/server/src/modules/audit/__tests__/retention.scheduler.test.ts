import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

vi.mock("../service.js", () => ({
  deleteOldAuditLogs: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => {
  // Stable logger instance — same object returned on every getLogger() call
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: vi.fn(() => logger) };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { prisma } from "../../../shared/prisma.js";
import { getLogger } from "../../../utils/logger.js";
import { getConfigValue } from "../../config/service.js";
import {
  initAuditRetentionOnBoot,
  startAuditRetentionScheduler,
  stopAuditRetentionScheduler,
} from "../retention.scheduler.js";
import { deleteOldAuditLogs, logAuditEvent } from "../service.js";

// Obtain the stable logger instance created inside the vi.mock factory.
// Because getLogger always returns the same object, this reference is valid
// for the lifetime of the test file.
const mockLogger = getLogger() as unknown as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Audit retention scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default mock: WAL mode is enabled
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ journal_mode: "wal" }] as never);
    // Default mock: retention = 30 days
    vi.mocked(getConfigValue).mockResolvedValue("30");
    // Default mock: no logs deleted
    vi.mocked(deleteOldAuditLogs).mockResolvedValue(0);
    // Default mock: logAuditEvent succeeds
    vi.mocked(logAuditEvent).mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopAuditRetentionScheduler();
    vi.useRealTimers();
  });

  describe("startAuditRetentionScheduler", () => {
    it("schedules cleanup after ONE_DAY_MS (24 hours)", async () => {
      startAuditRetentionScheduler();

      expect(deleteOldAuditLogs).not.toHaveBeenCalled();

      // Advance just under 24h — should not fire
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
      expect(deleteOldAuditLogs).not.toHaveBeenCalled();

      // Advance past 24h — should fire
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
      expect(getConfigValue).toHaveBeenCalledWith("auditRetentionDays");
    });

    it("chains next execution after cleanup runs", async () => {
      vi.mocked(deleteOldAuditLogs).mockResolvedValue(5);
      startAuditRetentionScheduler();

      // First run
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);
      expect(deleteOldAuditLogs).toHaveBeenCalledTimes(1);

      // Second run (chained)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);
      expect(deleteOldAuditLogs).toHaveBeenCalledTimes(2);
    });

    it("logs audit event when records are deleted", async () => {
      vi.mocked(deleteOldAuditLogs).mockResolvedValue(42);
      startAuditRetentionScheduler();

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "AUDIT_RETENTION_CLEANUP",
          ipAddress: "system",
          metadata: expect.objectContaining({ deletedCount: 42 }),
        }),
      );
    });

    it("does not log audit event when no records are deleted", async () => {
      vi.mocked(deleteOldAuditLogs).mockResolvedValue(0);
      startAuditRetentionScheduler();

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it("skips deletion when retentionDays is 0", async () => {
      vi.mocked(getConfigValue).mockResolvedValue("0");
      startAuditRetentionScheduler();

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      expect(deleteOldAuditLogs).not.toHaveBeenCalled();
    });
  });

  describe("stopAuditRetentionScheduler", () => {
    it("clears the scheduled timeout and prevents cleanup from running", async () => {
      startAuditRetentionScheduler();
      stopAuditRetentionScheduler();

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      expect(deleteOldAuditLogs).not.toHaveBeenCalled();
    });

    it("is idempotent — can be called when no scheduler is running", () => {
      expect(() => stopAuditRetentionScheduler()).not.toThrow();
    });
  });

  describe("superseded timer guard", () => {
    it("skips execution when the timer has been superseded by a restart", async () => {
      startAuditRetentionScheduler();
      // Restart immediately — supersedes the previous timer
      startAuditRetentionScheduler();

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      // Only the second timer should run; first is superseded and skipped
      expect(deleteOldAuditLogs).toHaveBeenCalledTimes(1);
    });
  });

  describe("initAuditRetentionOnBoot", () => {
    it("runs an initial cleanup immediately on boot", async () => {
      vi.mocked(deleteOldAuditLogs).mockResolvedValue(10);

      await initAuditRetentionOnBoot();

      expect(deleteOldAuditLogs).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 10 }),
        "Audit retention initial cleanup completed",
      );
    });

    it("skips initial deletion when retentionDays is 0", async () => {
      vi.mocked(getConfigValue).mockResolvedValue("0");

      await initAuditRetentionOnBoot();

      expect(deleteOldAuditLogs).not.toHaveBeenCalled();
    });

    it("warns when WAL mode cannot be enabled", async () => {
      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ journal_mode: "delete" }] as never);

      await initAuditRetentionOnBoot();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ journalMode: "delete" }),
        expect.stringContaining("WAL mode"),
      );
    });

    it("does not throw when initial cleanup fails", async () => {
      vi.mocked(getConfigValue).mockRejectedValue(new Error("Config read failed"));

      await expect(initAuditRetentionOnBoot()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Initial audit retention cleanup failed",
      );
    });

    it("still starts the scheduler even after initial cleanup failure", async () => {
      vi.mocked(getConfigValue).mockRejectedValue(new Error("Config unavailable"));

      await initAuditRetentionOnBoot();

      // The scheduler should be running — advance time and it should trigger
      vi.mocked(getConfigValue).mockResolvedValue("30");
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1);

      expect(getConfigValue).toHaveBeenCalledTimes(2); // once for boot, once for scheduled run
    });
  });
});
