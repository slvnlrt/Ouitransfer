import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { getConfigValue } from "../config/service.js";
import { QuotaRepository } from "./repository.js";

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
}

/** Singleton instance — import this instead of instantiating `new QuotaService()`. */
export const quotaService = new QuotaService();
