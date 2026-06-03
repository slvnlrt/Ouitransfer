import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

vi.mock("../service.js", () => ({
  deactivateEndedShares: vi.fn(),
  deactivateEndedReverseShares: vi.fn(),
  deleteDeactivatedShares: vi.fn(),
  deleteDeactivatedReverseShares: vi.fn(),
  cleanupDeactivatedAccounts: vi.fn(),
  sweepOrphans: vi.fn(),
  enforceQuotaOverage: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => {
  // Stable logger instance — same object returned on every getLogger() call
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: vi.fn(() => logger) };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { getLogger } from "../../../utils/logger.js";
import { getConfigValue } from "../../config/service.js";
import {
  initCleanupOnBoot,
  startCleanupScheduler,
  stopCleanupScheduler,
} from "../cleanup.scheduler.js";
import {
  cleanupDeactivatedAccounts,
  deactivateEndedReverseShares,
  deactivateEndedShares,
  deleteDeactivatedReverseShares,
  deleteDeactivatedShares,
  enforceQuotaOverage,
  sweepOrphans,
} from "../service.js";

const mockLogger = getLogger() as unknown as {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Configure the mocked `getConfigValue` from a key→value map, falling back to a
 * sensible default for any key not present so individual tests only specify the
 * keys they care about.
 */
function mockConfig(overrides: Record<string, string>): void {
  const defaults: Record<string, string> = {
    autoCleanupEnabled: "false",
    autoCleanupIntervalHours: "24",
    autoCleanupGracePeriodDays: "7",
    autoCleanupNotifyDaysBefore: "3",
    accountDeactivationCleanupEnabled: "false",
    accountDeactivationCleanupDays: "30",
    autoCleanupOrphansEnabled: "false",
    autoCleanupOrphanMinAgeHours: "24",
    quotaSmartDeletionEnabled: "false",
    quotaGracePeriodDays: "7",
    quotaInactiveShareDays: "30",
  };
  const map = { ...defaults, ...overrides };
  vi.mocked(getConfigValue).mockImplementation(async (key: string) => {
    if (key in map) return map[key];
    throw new Error(`Unexpected config key: ${key}`);
  });
}

const DEACTIVATION_SUMMARY = { deactivated: 0, errors: 0 };
const DELETION_SUMMARY = { warned: 0, deleted: 0, errors: 0 };
const ACCOUNT_SUMMARY = { purgedAccounts: 0, errors: 0 };
const ORPHAN_SUMMARY = { dbDeleted: 0, s3Deleted: 0, errors: 0 };
const QUOTA_OVERAGE_SUMMARY = {
  usersProcessed: 0,
  filesDeleted: 0,
  bytesFreed: 0,
  blocked: 0,
  errors: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Cleanup scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockConfig({});
    vi.mocked(deactivateEndedShares).mockResolvedValue({ ...DEACTIVATION_SUMMARY });
    vi.mocked(deactivateEndedReverseShares).mockResolvedValue({ ...DEACTIVATION_SUMMARY });
    vi.mocked(deleteDeactivatedShares).mockResolvedValue({ ...DELETION_SUMMARY });
    vi.mocked(deleteDeactivatedReverseShares).mockResolvedValue({ ...DELETION_SUMMARY });
    vi.mocked(cleanupDeactivatedAccounts).mockResolvedValue({ ...ACCOUNT_SUMMARY });
    vi.mocked(sweepOrphans).mockResolvedValue({ ...ORPHAN_SUMMARY });
    vi.mocked(enforceQuotaOverage).mockResolvedValue({ ...QUOTA_OVERAGE_SUMMARY });
  });

  afterEach(() => {
    stopCleanupScheduler();
    vi.useRealTimers();
  });

  describe("master toggle", () => {
    it("runs no cleanup functions when disabled, but still reschedules", async () => {
      mockConfig({ autoCleanupEnabled: "false" });
      await startCleanupScheduler();

      // First scheduled run
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).not.toHaveBeenCalled();
      expect(deactivateEndedReverseShares).not.toHaveBeenCalled();
      expect(deleteDeactivatedShares).not.toHaveBeenCalled();
      expect(deleteDeactivatedReverseShares).not.toHaveBeenCalled();

      // A second run fires — proving the timer rescheduled despite being disabled
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(getConfigValue).toHaveBeenCalledWith("autoCleanupEnabled");
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    });

    it("runs the two-phase content lifecycle (deactivate then delete) with config-derived args", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        autoCleanupGracePeriodDays: "5",
        autoCleanupNotifyDaysBefore: "2",
      });

      // Record relative call order across the four lifecycle functions.
      const order: string[] = [];
      vi.mocked(deactivateEndedShares).mockImplementation(async () => {
        order.push("deactivateShares");
        return { ...DEACTIVATION_SUMMARY };
      });
      vi.mocked(deactivateEndedReverseShares).mockImplementation(async () => {
        order.push("deactivateReverseShares");
        return { ...DEACTIVATION_SUMMARY };
      });
      vi.mocked(deleteDeactivatedShares).mockImplementation(async () => {
        order.push("deleteShares");
        return { ...DELETION_SUMMARY };
      });
      vi.mocked(deleteDeactivatedReverseShares).mockImplementation(async () => {
        order.push("deleteReverseShares");
        return { ...DELETION_SUMMARY };
      });

      await startCleanupScheduler();
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      // Phase 1 (deactivate) takes no args; phase 2 (delete) takes grace + notify.
      expect(deactivateEndedShares).toHaveBeenCalledWith();
      expect(deactivateEndedReverseShares).toHaveBeenCalledWith();
      expect(deleteDeactivatedShares).toHaveBeenCalledWith({ graceDays: 5, notifyDaysBefore: 2 });
      expect(deleteDeactivatedReverseShares).toHaveBeenCalledWith({
        graceDays: 5,
        notifyDaysBefore: 2,
      });

      // Both deactivation sweeps run before BOTH deletion sweeps.
      expect(order).toEqual([
        "deactivateShares",
        "deactivateReverseShares",
        "deleteShares",
        "deleteReverseShares",
      ]);
    });

    it("never reads the retired maxViewsCleanupDays config key", async () => {
      mockConfig({ autoCleanupEnabled: "true" });
      await startCleanupScheduler();
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(getConfigValue).not.toHaveBeenCalledWith("maxViewsCleanupDays");
    });
  });

  describe("sub-gates (A7 / A9 / B2)", () => {
    it("skips account + orphan + quota cleanups when their flags are false", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        accountDeactivationCleanupEnabled: "false",
        autoCleanupOrphansEnabled: "false",
        quotaSmartDeletionEnabled: "false",
      });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(cleanupDeactivatedAccounts).not.toHaveBeenCalled();
      expect(sweepOrphans).not.toHaveBeenCalled();
      expect(enforceQuotaOverage).not.toHaveBeenCalled();
    });

    it("runs quota smart deletion only when its flag is true (with config-derived args)", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        quotaSmartDeletionEnabled: "true",
        quotaGracePeriodDays: "10",
        quotaInactiveShareDays: "45",
      });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(enforceQuotaOverage).toHaveBeenCalledWith({ graceDays: 10, inactiveShareDays: 45 });
      expect(cleanupDeactivatedAccounts).not.toHaveBeenCalled();
      expect(sweepOrphans).not.toHaveBeenCalled();
    });

    it("does not run quota smart deletion when its flag is off", async () => {
      mockConfig({ autoCleanupEnabled: "true", quotaSmartDeletionEnabled: "false" });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(enforceQuotaOverage).not.toHaveBeenCalled();
    });

    it("runs account cleanup only when its flag is true", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        accountDeactivationCleanupEnabled: "true",
        accountDeactivationCleanupDays: "45",
      });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(cleanupDeactivatedAccounts).toHaveBeenCalledWith({ days: 45 });
      expect(sweepOrphans).not.toHaveBeenCalled();
    });

    it("runs orphan sweep only when its flag is true", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        autoCleanupOrphansEnabled: "true",
        autoCleanupOrphanMinAgeHours: "12",
      });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      expect(sweepOrphans).toHaveBeenCalledWith({ minAgeHours: 12 });
      expect(cleanupDeactivatedAccounts).not.toHaveBeenCalled();
    });
  });

  describe("interval from config", () => {
    it("uses the configured interval (hours → ms)", async () => {
      mockConfig({ autoCleanupEnabled: "true", autoCleanupIntervalHours: "2" });
      await startCleanupScheduler();

      // Just under 2h — should not fire
      await vi.advanceTimersByTimeAsync(2 * ONE_HOUR_MS - 1000);
      expect(deactivateEndedShares).not.toHaveBeenCalled();

      // Past 2h — fires
      await vi.advanceTimersByTimeAsync(2000);
      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
    });

    it("falls back to the default interval when the value is unparseable", async () => {
      mockConfig({ autoCleanupEnabled: "true", autoCleanupIntervalHours: "not-a-number" });
      await startCleanupScheduler();

      // Should not fire before the 24h default
      await vi.advanceTimersByTimeAsync(23 * ONE_HOUR_MS);
      expect(deactivateEndedShares).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: "autoCleanupIntervalHours" }),
        expect.stringContaining("parse"),
      );
    });
  });

  describe("live config re-read", () => {
    it("re-reads config on every run so live changes take effect", async () => {
      mockConfig({ autoCleanupEnabled: "false" });
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).not.toHaveBeenCalled();

      // Flip the master toggle on between runs
      mockConfig({ autoCleanupEnabled: "true" });
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
    });
  });

  describe("structured summary log", () => {
    it("emits one aggregated info log per run accounting for differing shapes", async () => {
      mockConfig({
        autoCleanupEnabled: "true",
        accountDeactivationCleanupEnabled: "true",
        autoCleanupOrphansEnabled: "true",
        quotaSmartDeletionEnabled: "true",
      });
      vi.mocked(deactivateEndedShares).mockResolvedValue({ deactivated: 6, errors: 0 });
      vi.mocked(deleteDeactivatedShares).mockResolvedValue({ warned: 1, deleted: 2, errors: 0 });
      vi.mocked(cleanupDeactivatedAccounts).mockResolvedValue({ purgedAccounts: 3, errors: 0 });
      vi.mocked(sweepOrphans).mockResolvedValue({ dbDeleted: 4, s3Deleted: 5, errors: 0 });
      vi.mocked(enforceQuotaOverage).mockResolvedValue({
        usersProcessed: 7,
        filesDeleted: 8,
        bytesFreed: 9000,
        blocked: 2,
        errors: 0,
      });

      await startCleanupScheduler();
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      // Aggregated summary carries the new phase-1 (deactivated) + phase-2
      // (deleted) sub-shapes alongside the account + orphan + quota shapes.
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          summary: expect.objectContaining({
            deactivatedShares: { deactivated: 6, errors: 0 },
            deletedShares: { warned: 1, deleted: 2, errors: 0 },
            deactivatedAccounts: { purgedAccounts: 3, errors: 0 },
            orphans: { dbDeleted: 4, s3Deleted: 5, errors: 0 },
            quotaOverage: {
              usersProcessed: 7,
              filesDeleted: 8,
              bytesFreed: 9000,
              blocked: 2,
              errors: 0,
            },
          }),
        },
        "Cleanup run completed",
      );
    });
  });

  describe("failure tolerance", () => {
    it("continues other cleanups when one throws", async () => {
      mockConfig({ autoCleanupEnabled: "true" });
      vi.mocked(deactivateEndedShares).mockRejectedValue(new Error("boom"));

      await startCleanupScheduler();
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);

      // The other lifecycle sweeps still ran despite phase 1 throwing.
      expect(deactivateEndedReverseShares).toHaveBeenCalledTimes(1);
      expect(deleteDeactivatedShares).toHaveBeenCalledTimes(1);
      expect(deleteDeactivatedReverseShares).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Cleanup scheduler: deactivateEndedShares failed",
      );
    });
  });

  describe("stopCleanupScheduler", () => {
    it("cancels the pending timer and prevents cleanup from running", async () => {
      mockConfig({ autoCleanupEnabled: "true" });
      startCleanupScheduler();
      // Flush the async scheduleNext() so the pending timer is actually armed
      // before we stop it (startCleanupScheduler reads the interval from config
      // asynchronously, so the timer is set on a later microtask).
      await vi.advanceTimersByTimeAsync(0);
      stopCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).not.toHaveBeenCalled();
    });

    it("is idempotent — can be called when no scheduler is running", () => {
      expect(() => stopCleanupScheduler()).not.toThrow();
    });
  });

  describe("superseded timer guard", () => {
    it("only the most recent timer runs after a restart", async () => {
      mockConfig({ autoCleanupEnabled: "true" });
      await startCleanupScheduler();
      // Restart — supersedes the previous timer
      await startCleanupScheduler();

      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
    });
  });

  describe("initCleanupOnBoot", () => {
    it("runs an immediate first pass on boot when enabled", async () => {
      mockConfig({ autoCleanupEnabled: "true" });

      await initCleanupOnBoot();

      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
    });

    it("does not run cleanup on boot when disabled, but still starts the scheduler", async () => {
      mockConfig({ autoCleanupEnabled: "false" });

      await initCleanupOnBoot();
      expect(deactivateEndedShares).not.toHaveBeenCalled();

      // Scheduler is running — flip on and advance
      mockConfig({ autoCleanupEnabled: "true" });
      await vi.advanceTimersByTimeAsync(24 * ONE_HOUR_MS + 1);
      expect(deactivateEndedShares).toHaveBeenCalledTimes(1);
    });

    it("does not throw when the initial pass fails", async () => {
      vi.mocked(getConfigValue).mockRejectedValue(new Error("Config read failed"));

      await expect(initCleanupOnBoot()).resolves.not.toThrow();
    });
  });
});
