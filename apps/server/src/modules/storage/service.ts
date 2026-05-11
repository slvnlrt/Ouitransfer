import fs from "node:fs";
import { statfs } from "node:fs/promises";
import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, ValidationError } from "../../utils/app-error.js";
import { IS_RUNNING_IN_CONTAINER } from "../../utils/container-detection.js";
import { getLogger } from "../../utils/logger.js";
import { ConfigService } from "../config/service.js";

export class StorageService {
  private configService = new ConfigService();

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
  }> {
    try {
      if (isAdmin) {
        const diskInfo = await this._getDiskSpaceMultiplePaths();

        if (!diskInfo) {
          throw new AppError(
            503,
            "Unable to determine actual disk space - system configuration issue",
            "DISK_SPACE_DETECTION_FAILED",
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
        const maxTotalStorage = BigInt(await this.configService.getValue("maxTotalStoragePerUser"));
        const maxStorageGB = this._ensureNumber(Number(maxTotalStorage) / (1024 * 1024 * 1024), 10);

        const userFiles = await prisma.file.findMany({
          where: { userId },
          select: { size: true },
        });

        const totalUsedStorage = userFiles.reduce((acc, file) => acc + file.size, BigInt(0));
        const usedStorageGB = this._ensureNumber(
          Number(totalUsedStorage) / (1024 * 1024 * 1024),
          0,
        );
        const availableStorageGB = this._ensureNumber(maxStorageGB - usedStorageGB, 0);

        return {
          diskSizeGB: Number(maxStorageGB.toFixed(2)),
          diskUsedGB: Number(usedStorageGB.toFixed(2)),
          diskAvailableGB: Number(availableStorageGB.toFixed(2)),
          uploadAllowed: availableStorageGB > 0,
        };
      }

      throw new ValidationError("User ID is required for non-admin users");
    } catch (error) {
      if (error instanceof AppError) throw error;
      getLogger().error({ err: error }, "Error getting disk space");
      throw new AppError(
        500,
        `Failed to get disk space information: ${error instanceof Error ? error.message : String(error)}`,
        "DISK_SPACE_ERROR",
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
    fileSizeInfo: {
      bytes: number;
      kb: number;
      mb: number;
      gb: number;
    };
  }> {
    const diskSpace = await this.getDiskSpace(userId);
    const fileSizeGB = fileSize / (1024 * 1024 * 1024);

    return {
      ...diskSpace,
      uploadAllowed: diskSpace.diskAvailableGB > fileSizeGB,
      fileSizeInfo: {
        bytes: fileSize,
        kb: Number((fileSize / 1024).toFixed(2)),
        mb: Number((fileSize / (1024 * 1024)).toFixed(2)),
        gb: Number((fileSize / (1024 * 1024 * 1024)).toFixed(2)),
      },
    };
  }
}
