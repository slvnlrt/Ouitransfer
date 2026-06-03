import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import { emailService } from "../email/service.js";
import { type DeletionCandidateFile, QuotaRepository } from "./repository.js";

export type WarningLevel = "none" | "warning" | "critical" | "exceeded";

export type QuotaSource = "user" | "group" | "global" | "admin-default";

export interface EffectiveLimits {
  maxFileSize: bigint;
  maxTotalStorage: bigint;
  overrides: {
    maxFileSizeOverride: bigint | null;
    maxTotalStorageOverride: bigint | null;
  };
  sources: {
    maxFileSizeSource: QuotaSource;
    maxTotalStorageSource: QuotaSource;
    groupName: string | null;
  };
}

export interface QuotaStatus {
  used: bigint;
  maxTotalStorage: bigint;
  maxFileSize: bigint;
  percentage: number;
  warningLevel: WarningLevel;
  uploadAllowed: boolean;
  overrides: {
    maxFileSizeOverride: bigint | null;
    maxTotalStorageOverride: bigint | null;
  };
  sources: {
    maxFileSizeSource: QuotaSource;
    maxTotalStorageSource: QuotaSource;
    groupName: string | null;
  };
}

export class QuotaService {
  private repository = new QuotaRepository();

  /**
   * Resolve the effective limits for a user.
   * Resolution order: per-user override → group override → global default.
   * Admin default is unlimited (0n) when no override is set.
   * null = no override (inherit), 0 = unlimited, >0 = explicit limit in bytes.
   */
  async resolveEffectiveLimits(userId: string): Promise<EffectiveLimits> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isAdmin: true,
        maxFileSizeOverride: true,
        maxTotalStorageOverride: true,
        group: {
          select: {
            name: true,
            maxFileSizeOverride: true,
            maxTotalStorageOverride: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const maxFileSize =
      user.maxFileSizeOverride ??
      user.group?.maxFileSizeOverride ??
      (user.isAdmin ? 0n : BigInt(await getConfigValue("maxFileSize")));

    const maxTotalStorage =
      user.maxTotalStorageOverride ??
      user.group?.maxTotalStorageOverride ??
      (user.isAdmin ? 0n : BigInt(await getConfigValue("maxTotalStoragePerUser")));

    const maxFileSizeSource: QuotaSource =
      user.maxFileSizeOverride != null
        ? "user"
        : user.group?.maxFileSizeOverride != null
          ? "group"
          : user.isAdmin
            ? "admin-default"
            : "global";

    const maxTotalStorageSource: QuotaSource =
      user.maxTotalStorageOverride != null
        ? "user"
        : user.group?.maxTotalStorageOverride != null
          ? "group"
          : user.isAdmin
            ? "admin-default"
            : "global";

    return {
      maxFileSize,
      maxTotalStorage,
      overrides: {
        maxFileSizeOverride: user.maxFileSizeOverride,
        maxTotalStorageOverride: user.maxTotalStorageOverride,
      },
      sources: {
        maxFileSizeSource,
        maxTotalStorageSource,
        groupName: user.group?.name ?? null,
      },
    };
  }

  /**
   * Calculate total storage used by a user (File + ReverseShareFile).
   */
  async calculateStorageUsed(userId: string): Promise<bigint> {
    return this.repository.calculateStorageUsed(userId);
  }

  /**
   * Get full quota status for a user: usage, limits, percentage, warning level.
   */
  async getQuotaStatus(userId: string): Promise<QuotaStatus> {
    const [limits, used] = await Promise.all([
      this.resolveEffectiveLimits(userId),
      this.calculateStorageUsed(userId),
    ]);

    const isUnlimited = limits.maxTotalStorage === 0n;

    let percentage = 0;
    if (!isUnlimited && limits.maxTotalStorage > 0n) {
      const raw = (Number(used) / Number(limits.maxTotalStorage)) * 100;
      // Ensure non-zero usage always shows at least 1% — never display "0%" when files exist
      percentage = used > 0n ? Math.max(1, Math.round(raw)) : 0;
    }

    let warningLevel: WarningLevel = "none";
    if (!isUnlimited) {
      if (used >= limits.maxTotalStorage) {
        warningLevel = "exceeded";
      } else if (percentage >= 90) {
        warningLevel = "critical";
      } else if (percentage >= 80) {
        warningLevel = "warning";
      }
    }

    const uploadAllowed = isUnlimited || used < limits.maxTotalStorage;

    return {
      used,
      maxTotalStorage: limits.maxTotalStorage,
      maxFileSize: limits.maxFileSize,
      percentage,
      warningLevel,
      uploadAllowed,
      overrides: limits.overrides,
      sources: limits.sources,
    };
  }

  // ─── Phase B pure helpers (5.2 quota overage policy) ──────────────────────
  // No side effects, no DB writes, no triggers. Wiring lives in Batches 2/3.

  /**
   * Parse the `quotaWarningThresholds` CSV (e.g. `"80,90"`) into a clean list of
   * percentages: trimmed, integer, **sorted ascending**, and de-duplicated.
   *
   * The config validator already guarantees each entry is an integer in 1–99
   * and the list is non-empty, so this never has to reject input — it only
   * normalizes it for {@link highestCrossedThreshold}.
   */
  parseThresholds(csv: string): number[] {
    const unique = new Set<number>();
    for (const part of csv.split(",")) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const n = Number(trimmed);
      if (Number.isInteger(n)) unique.add(n);
    }
    return [...unique].sort((a, b) => a - b);
  }

  /**
   * The byte boundary at which a usage `threshold` (a percentage) is reached for
   * a given `limit`. `>= 100` collapses to the limit itself (the "exceeded"
   * boundary). Uses bigint math throughout so large byte counts stay exact;
   * fractional percentages of a byte are floored (the boundary is the first
   * byte at or above the percentage), which is irrelevant at real quota sizes.
   */
  private thresholdBoundary(threshold: number, limit: bigint): bigint {
    if (threshold >= 100) return limit;
    return (limit * BigInt(threshold)) / 100n;
  }

  /**
   * Given a usage transition from `oldUsed` to `newUsed` against `limit`, return
   * the **highest** threshold whose byte-boundary is newly crossed *upward*
   * (boundary `> oldUsed` AND `<= newUsed`), or `null` if none was crossed.
   *
   * - Only upward crossings count (a drop in usage never "crosses" a threshold).
   * - `>= 100` thresholds use the limit itself as their boundary (≥ limit ⇒
   *   exceeded).
   * - An unlimited limit (`0n`) has no boundaries and always returns `null`.
   *
   * `thresholds` should come from {@link parseThresholds} (sorted ascending);
   * this still returns the maximum crossed value regardless of input order.
   */
  highestCrossedThreshold(
    oldUsed: bigint,
    newUsed: bigint,
    limit: bigint,
    thresholds: number[],
  ): number | null {
    if (limit <= 0n) return null;

    let highest: number | null = null;
    for (const threshold of thresholds) {
      const boundary = this.thresholdBoundary(threshold, limit);
      if (boundary > oldUsed && newUsed >= boundary) {
        if (highest === null || threshold > highest) highest = threshold;
      }
    }
    return highest;
  }

  /**
   * Soft-enforcement decision for an **external** reverse-share upload (B3).
   *
   * - Unlimited owner limit (`0n`) ⇒ always allowed.
   * - Otherwise allowed iff the projected usage (`used + size`) stays within
   *   BOTH bounds:
   *     - the relative cap `limit * factor`, AND
   *     - the absolute cap `capBytes` (when `capBytes > 0n`; `<= 0n` = no cap).
   *
   * Pure: callers gate this behind `reverseShareQuotaSoftEnforcement` and supply
   * `factor`/`capBytes` from config.
   */
  isReverseUploadAllowed(
    used: bigint,
    size: bigint,
    limit: bigint,
    factor: number,
    capBytes: bigint,
  ): boolean {
    if (limit <= 0n) return true;

    const projected = used + size;
    const relativeCap = limit * BigInt(factor);
    if (projected > relativeCap) return false;
    if (capBytes > 0n && projected > capBytes) return false;
    return true;
  }

  /**
   * Build the ordered list of files to delete to free at least `bytesToFree`
   * for a user, for the opt-in quota smart-deletion sweep (B2). Pure read /
   * selection — performs **no** deletion. Order (safest first):
   *
   *   1. **Orphan uploads** — files in no share and no shared folder, oldest
   *      `createdAt` first ({@link QuotaRepository.findOrphanFiles}).
   *   2. **Inactive-share files** — files whose every referencing share (direct
   *      or via a shared folder) has had no activity for ≥ `inactiveShareDays`,
   *      oldest first ({@link QuotaRepository.findInactiveShareFiles}). Files in
   *      any recently-active share are excluded by the query and therefore can
   *      never appear here.
   *
   * Accumulates candidates in that order and stops as soon as the cumulative
   * size reaches `bytesToFree`. Returns all safe candidates (possibly fewer
   * bytes than requested) when no further safe file exists — the caller then
   * leaves the user blocked rather than deleting active-share content.
   */
  async pickDeletionCandidates(
    userId: string,
    bytesToFree: bigint,
    inactiveShareDays: number,
    now: Date = new Date(),
  ): Promise<DeletionCandidateFile[]> {
    const selected: DeletionCandidateFile[] = [];
    if (bytesToFree <= 0n) return selected;

    let freed = 0n;
    const take = (files: DeletionCandidateFile[]): boolean => {
      for (const file of files) {
        selected.push(file);
        freed += file.size;
        if (freed >= bytesToFree) return true;
      }
      return false;
    };

    const orphans = await this.repository.findOrphanFiles(userId);
    if (take(orphans)) return selected;

    const inactiveBefore = new Date(now.getTime() - inactiveShareDays * 24 * 60 * 60 * 1000);
    const inactive = await this.repository.findInactiveShareFiles(userId, inactiveBefore);
    take(inactive);
    return selected;
  }

  // ─── B1 threshold warnings (event-driven) ─────────────────────────────────

  /**
   * Evaluate a user's storage usage after an upload register and notify them
   * the first time usage **crosses** a configured warning threshold upward
   * (5.2 Phase B B1). Centralizes the dedup + re-arm bookkeeping so any path
   * that changes a user's usage (direct file register, reverse-share register,
   * and later the smart-deletion sweep) gets consistent behavior.
   *
   * Behavior:
   * - Unlimited limit (`0n`) ⇒ no-op (no thresholds, no exceeded state).
   * - Computes the highest threshold newly crossed via
   *   {@link highestCrossedThreshold}. A warning fires only when that crossed
   *   threshold is **higher** than the stored `quotaLastWarnedThreshold`
   *   (dedup) — so repeated uploads in the same band never re-spam.
   * - `>= 100%`: enqueues `quota_exceeded` to the owner (with the configured
   *   `gracePeriodDays`) and, when the user **transitions** into the exceeded
   *   state (`quotaExceededSince` was null), also alerts admins via
   *   `admin_quota_alert`. `quotaExceededSince` is set iff currently null.
   * - sub-100% crossing: enqueues `quota_warning` to the owner.
   * - **Re-arm**: when `newUsed` drops below the lowest threshold boundary,
   *   `quotaLastWarnedThreshold` is reset to null; when `newUsed < limit`,
   *   `quotaExceededSince` is cleared. These keep the Batch 3 grace clock
   *   (`quotaExceededSince`) correct: it is SET on the first crossing into
   *   ≥100% and CLEARED as soon as usage is back under the limit.
   *
   * **No-throw / fire-and-forget contract**: this never throws into the upload
   * path. All errors are caught and logged. Callers invoke it without awaiting
   * (or with a `.catch`) so it never blocks the upload response.
   *
   * @param userId  The owner whose quota is being evaluated.
   * @param usage   `{ oldUsed, newUsed }` byte counts around the upload. When
   *   the caller only knows the size delta, pass `oldUsed = newUsed - size`.
   */
  async evaluateAndNotifyQuota(
    userId: string,
    usage: { oldUsed: bigint; newUsed: bigint },
  ): Promise<void> {
    const log = getLogger();
    try {
      const { oldUsed, newUsed } = usage;

      const limits = await this.resolveEffectiveLimits(userId);
      const limit = limits.maxTotalStorage;
      // Unlimited ⇒ nothing to warn about; also clear any stale state defensively.
      if (limit <= 0n) return;

      const thresholdsCsv = await getConfigValue("quotaWarningThresholds");
      const thresholds = this.parseThresholds(thresholdsCsv);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          locale: true,
          firstName: true,
          lastName: true,
          isActive: true,
          quotaLastWarnedThreshold: true,
          quotaExceededSince: true,
        },
      });
      if (!user) return;

      // Re-arm bookkeeping (independent of any new crossing).
      const updates: {
        quotaLastWarnedThreshold?: number | null;
        quotaExceededSince?: Date | null;
      } = {};
      const lowestBoundary =
        thresholds.length > 0 ? this.thresholdBoundary(thresholds[0]!, limit) : null;
      // Drop below the lowest threshold ⇒ re-arm the warning dedup.
      if (
        lowestBoundary !== null &&
        newUsed < lowestBoundary &&
        user.quotaLastWarnedThreshold !== null
      ) {
        updates.quotaLastWarnedThreshold = null;
      }
      // Back under the hard limit ⇒ clear the exceeded grace clock.
      if (newUsed < limit && user.quotaExceededSince !== null) {
        updates.quotaExceededSince = null;
      }

      const crossed = this.highestCrossedThreshold(oldUsed, newUsed, limit, thresholds);
      const exceeded = newUsed >= limit;
      const transitionsIntoExceeded = exceeded && user.quotaExceededSince === null;

      // A warning/exceeded email fires only when the newly-crossed threshold is
      // strictly higher than the one we last warned about (dedup), OR when the
      // user transitions into the exceeded state for the first time.
      const lastWarned = user.quotaLastWarnedThreshold;
      const shouldNotify = crossed !== null && (lastWarned === null || crossed > lastWarned);

      if (shouldNotify) {
        updates.quotaLastWarnedThreshold = crossed;
      }
      if (transitionsIntoExceeded) {
        updates.quotaExceededSince = new Date();
      }

      // Persist state first so the grace clock / dedup are durable even if the
      // (best-effort) notifications below fail.
      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: userId }, data: updates });
      }

      // Skip emails for deactivated accounts (consistent with other notifiers),
      // but the state updates above still apply.
      if (user.isActive === false) return;

      const usedBytes = Number(newUsed);
      const maxBytes = Number(limit);
      const usedPercent = Math.max(1, Math.round((Number(newUsed) / Number(limit)) * 100));

      if (shouldNotify && exceeded) {
        const gracePeriodDays = await this.resolveGracePeriodDays();
        await emailService.send("quota_exceeded", {
          to: user.email,
          locale: user.locale ?? "en",
          userId,
          data: { usedBytes, maxBytes, gracePeriodDays },
        });
      } else if (shouldNotify) {
        await emailService.send("quota_warning", {
          to: user.email,
          locale: user.locale ?? "en",
          userId,
          data: { usedPercent, usedBytes, maxBytes },
        });
      }

      // Alert admins only on the transition into exceeded — deduped by the same
      // quotaExceededSince set-iff-null gate, so it never spams per upload.
      if (transitionsIntoExceeded) {
        const userName = `${user.firstName} ${user.lastName}`.trim();
        await emailService.sendToAdmins("admin_quota_alert", {
          userName: userName || user.email,
          userEmail: user.email,
          usedPercent,
          usedBytes,
          maxBytes,
        });
      }
    } catch (err) {
      log.error({ err, userId }, "evaluateAndNotifyQuota failed (non-fatal)");
    }
  }

  /** Read `quotaGracePeriodDays` (≥ 0); fall back to 7 if unset/invalid. */
  private async resolveGracePeriodDays(): Promise<number> {
    try {
      const raw = await getConfigValue("quotaGracePeriodDays");
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 7;
    } catch {
      return 7;
    }
  }
}

/** Singleton instance — import this instead of instantiating `new QuotaService()`. */
export const quotaService = new QuotaService();
