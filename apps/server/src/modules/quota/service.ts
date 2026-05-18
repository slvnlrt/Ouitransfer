import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { getConfigValue } from "../config/service.js";
import { QuotaRepository } from "./repository.js";

export type WarningLevel = "none" | "warning" | "critical" | "exceeded";

export interface EffectiveLimits {
  maxFileSize: bigint;
  maxTotalStorage: bigint;
  overrides: {
    maxFileSizeOverride: bigint | null;
    maxTotalStorageOverride: bigint | null;
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
}

export class QuotaService {
  private repository = new QuotaRepository();

  /**
   * Resolve the effective limits for a user.
   * Resolution order: per-user override → (group placeholder for 5.4) → global default.
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
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const maxTotalStorage =
      user.maxTotalStorageOverride ??
      // placeholder: group?.maxTotalStorage — will be filled in 5.4 Groups
      (user.isAdmin ? 0n : BigInt(await getConfigValue("maxTotalStoragePerUser")));

    const maxFileSize =
      user.maxFileSizeOverride ??
      // placeholder: group?.maxFileSize — will be filled in 5.4 Groups
      (user.isAdmin ? 0n : BigInt(await getConfigValue("maxFileSize")));

    return {
      maxFileSize,
      maxTotalStorage,
      overrides: {
        maxFileSizeOverride: user.maxFileSizeOverride,
        maxTotalStorageOverride: user.maxTotalStorageOverride,
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
      percentage = Math.round((Number(used) / Number(limits.maxTotalStorage)) * 100);
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
    };
  }
}
