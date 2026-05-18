import fs from "node:fs";
import { statfs } from "node:fs/promises";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
import { AppError, ValidationError } from "../../utils/app-error.js";
import { IS_RUNNING_IN_CONTAINER } from "../../utils/container-detection.js";
import { getLogger } from "../../utils/logger.js";
import { QuotaService, type WarningLevel } from "../quota/service.js";

export class StorageService {
  private quotaService = new QuotaService();

  private _ensureNumber(value: number, fallback: number = 0): number {
    return Number.isNaN(value) || !Number.isFinite(value) || value < 0 ? fallback : value;
  }

  private async _getFileSystemInfo(
    path: string,
  ): Promise<{ total: number; available: number } | null> {
    try {
      const stats = await statfs(path);
      const total = stats.bsize * stats.blocks;
      const available = stats.bsize * stats.bavail;
      return { total, available };
    } catch {
      return null;
    }
  }

  private async _detectSynologyVolumes(): Promise<string[]> {
    try {
      if (!fs.existsSync("/proc/mounts")) {
        return [];
      }

      const mountsContent = await fs.promises.readFile("/proc/mounts", "utf8");
      const lines = mountsContent.split("\n").filter((line) => line.trim());
      const synologyPaths: string[] = [];

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const [, mountPoint] = parts;

          if (mountPoint.match(/^\/volume\d+$/)) {
            synologyPaths.push(mountPoint);
          }
        }
      }

      return synologyPaths;
    } catch {
      return [];
    }
  }

  private async _getDiskSpaceMultiplePaths(): Promise<{ total: number; available: number } | null> {
    const basePaths = IS_RUNNING_IN_CONTAINER
      ? [
          "/app/server/uploads",
          "/app/server/temp-uploads",
          "/app/server/temp-chunks",
          "/app/server",
          "/app",
          "/",
        ]
      : [env.CUSTOM_PATH || ".", "./uploads", process.cwd()];

    const synologyPaths = await this._detectSynologyVolumes();
    const pathsToTry = [...basePaths, ...synologyPaths];

    for (const pathToCheck of pathsToTry) {
      if (pathToCheck.includes("uploads") || pathToCheck.includes("temp-")) {
        try {
          if (!fs.existsSync(pathToCheck)) {
            fs.mkdirSync(pathToCheck, { recursive: true });
          }
        } catch {
          continue;
        }
      }

      if (!fs.existsSync(pathToCheck)) {
        continue;
      }

      const result = await this._getFileSystemInfo(pathToCheck);
      if (result) {
        return result;
      }
    }

    return null;
  }

  async getDiskSpace(
    userId?: string,
    isAdmin?: boolean,
  ): Promise<{
    diskSizeGB: number;
    diskUsedGB: number;
    diskAvailableGB: number;
    uploadAllowed: boolean;
    warningLevel?: WarningLevel;
    maxFileSize?: number;
    percentage?: number;
  }> {
    try {
      if (isAdmin) {
        const diskInfo = await this._getDiskSpaceMultiplePaths();

        if (!diskInfo) {
          throw new AppError(
            503,
            "Unable to determine actual disk space - system configuration issue",
            ErrorCodes.DISK_SPACE_DETECTION_FAILED,
          );
        }

        const { total, available } = diskInfo;
        const used = total - available;

        const diskSizeGB = this._ensureNumber(total / (1024 * 1024 * 1024), 0);
        const diskUsedGB = this._ensureNumber(used / (1024 * 1024 * 1024), 0);
        const diskAvailableGB = this._ensureNumber(available / (1024 * 1024 * 1024), 0);

        return {
          diskSizeGB: Number(diskSizeGB.toFixed(2)),
          diskUsedGB: Number(diskUsedGB.toFixed(2)),
          diskAvailableGB: Number(diskAvailableGB.toFixed(2)),
          uploadAllowed: diskAvailableGB > 0.1,
        };
      } else if (userId) {
        const status = await this.quotaService.getQuotaStatus(userId);

        const isUnlimited = status.maxTotalStorage === 0n;
        const maxStorageGB = isUnlimited
          ? 0
          : this._ensureNumber(Number(status.maxTotalStorage) / (1024 * 1024 * 1024), 10);
        const usedStorageGB = this._ensureNumber(Number(status.used) / (1024 * 1024 * 1024), 0);
        const availableStorageGB = isUnlimited
          ? Number.MAX_SAFE_INTEGER
          : this._ensureNumber(maxStorageGB - usedStorageGB, 0);

        return {
          diskSizeGB: Number(maxStorageGB.toFixed(2)),
          diskUsedGB: Number(usedStorageGB.toFixed(2)),
          diskAvailableGB: isUnlimited ? -1 : Number(availableStorageGB.toFixed(2)),
          uploadAllowed: status.uploadAllowed,
          warningLevel: status.warningLevel,
          maxFileSize: status.maxFileSize === 0n ? 0 : Number(status.maxFileSize),
          percentage: status.percentage,
        };
      }

      throw new ValidationError("User ID is required for non-admin users");
    } catch (error) {
      if (error instanceof AppError) throw error;
      getLogger().error({ err: error }, "Error getting disk space");
      throw new AppError(
        500,
        "Failed to retrieve disk space information",
        ErrorCodes.DISK_SPACE_ERROR,
      );
    }
  }

  async checkUploadAllowed(
    fileSize: number,
    userId?: string,
  ): Promise<{
    diskSizeGB: number;
    diskUsedGB: number;
    diskAvailableGB: number;
    uploadAllowed: boolean;
    warningLevel?: WarningLevel;
    maxFileSize?: number;
    percentage?: number;
    fileSizeInfo: {
      bytes: number;
      kb: number;
      mb: number;
      gb: number;
    };
  }> {
    const diskSpace = await this.getDiskSpace(userId);
    const fileSizeGB = fileSize / (1024 * 1024 * 1024);
    // diskAvailableGB === -1 signals unlimited quota — upload is always allowed
    const uploadAllowed =
      diskSpace.diskAvailableGB === -1 || diskSpace.diskAvailableGB > fileSizeGB;

    return {
      ...diskSpace,
      uploadAllowed,
      fileSizeInfo: {
        bytes: fileSize,
        kb: Number((fileSize / 1024).toFixed(2)),
        mb: Number((fileSize / (1024 * 1024)).toFixed(2)),
        gb: Number((fileSize / (1024 * 1024 * 1024)).toFixed(2)),
      },
    };
  }
}
