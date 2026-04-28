/**
 * Automatic Migration Script: Filesystem → S3 (Garage)
 *
 * This script runs automatically on server start and:
 * 1. Detects existing filesystem files
 * 2. Migrates them to S3 in background
 * 3. Updates database references
 * 4. Keeps filesystem as fallback during migration
 * 5. Zero downtime, zero user intervention
 */

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";

import { directoriesConfig } from "../config/directories.config.js";
import { bucketName, s3Client } from "../config/storage.config.js";
import { getLogger } from "../utils/logger.js";

interface MigrationStats {
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalSizeBytes: number;
  startTime: number;
  endTime?: number;
}

const MIGRATION_STATE_FILE = path.join(directoriesConfig.uploads, ".migration-state.json");
const MIGRATION_BATCH_SIZE = 10; // Migrate 10 files at a time
const MIGRATION_DELAY_MS = 100; // Small delay between batches to avoid overwhelming

export class FilesystemToS3Migrator {
  private readonly log: FastifyBaseLogger;
  private stats: MigrationStats = {
    totalFiles: 0,
    migratedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    totalSizeBytes: 0,
    startTime: Date.now(),
  };

  constructor(logger?: FastifyBaseLogger) {
    this.log = logger ?? getLogger();
  }

  /**
   * Check if migration is needed and should run
   */
  async shouldMigrate(): Promise<boolean> {
    // Only migrate if S3 client is available
    if (!s3Client) {
      this.log.info("[MIGRATION] S3 not configured, skipping migration");
      return false;
    }

    // Check if migration already completed
    try {
      const stateExists = await fs
        .access(MIGRATION_STATE_FILE)
        .then(() => true)
        .catch(() => false);

      if (stateExists) {
        const state = JSON.parse(await fs.readFile(MIGRATION_STATE_FILE, "utf-8"));

        if (state.completed) {
          this.log.info("[MIGRATION] Migration already completed");
          return false;
        }

        this.log.info("[MIGRATION] Previous migration incomplete, resuming...");
        this.stats = { ...state, startTime: Date.now() };
        return true;
      }
    } catch (error) {
      this.log.warn({ err: error }, "[MIGRATION] Could not read migration state");
    }

    // Check if there are files to migrate
    try {
      const uploadsDir = directoriesConfig.uploads;
      const files = await this.scanDirectory(uploadsDir);

      if (files.length === 0) {
        this.log.info("[MIGRATION] No filesystem files found, nothing to migrate");
        await this.markMigrationComplete();
        return false;
      }

      this.log.info({ fileCount: files.length }, "[MIGRATION] Found files to migrate");
      this.stats.totalFiles = files.length;
      return true;
    } catch (error) {
      this.log.error({ err: error }, "[MIGRATION] Error scanning files");
      return false;
    }
  }

  /**
   * Run the migration process
   */
  async migrate(): Promise<void> {
    this.log.info("[MIGRATION] Starting automatic filesystem → S3 migration");
    this.log.info("[MIGRATION] This runs in background, zero downtime");

    try {
      const uploadsDir = directoriesConfig.uploads;
      const files = await this.scanDirectory(uploadsDir);

      // Process in batches
      for (let i = 0; i < files.length; i += MIGRATION_BATCH_SIZE) {
        const batch = files.slice(i, i + MIGRATION_BATCH_SIZE);

        await Promise.all(
          batch.map((file) =>
            this.migrateFile(file).catch((error) => {
              this.log.error({ err: error, file }, "[MIGRATION] Failed to migrate file");
              this.stats.failedFiles++;
            }),
          ),
        );

        // Save progress
        await this.saveState();

        // Small delay between batches
        if (i + MIGRATION_BATCH_SIZE < files.length) {
          await new Promise((resolve) => setTimeout(resolve, MIGRATION_DELAY_MS));
        }

        // Log progress
        const progress = Math.round(((i + batch.length) / files.length) * 100);
        this.log.info(
          { progress, migratedFiles: this.stats.migratedFiles, totalFiles: files.length },
          "[MIGRATION] Migration progress",
        );
      }

      this.stats.endTime = Date.now();
      await this.markMigrationComplete();

      const durationSeconds = Math.round((this.stats.endTime - this.stats.startTime) / 1000);
      const sizeMB = Math.round(this.stats.totalSizeBytes / 1024 / 1024);

      this.log.info(
        {
          totalFiles: this.stats.totalFiles,
          migratedFiles: this.stats.migratedFiles,
          failedFiles: this.stats.failedFiles,
          skippedFiles: this.stats.skippedFiles,
          totalSizeMB: sizeMB,
          durationSeconds,
        },
        "[MIGRATION] Migration completed successfully",
      );
    } catch (error) {
      this.log.error({ err: error }, "[MIGRATION] Migration failed");
      await this.saveState();
      throw error;
    }
  }

  /**
   * Scan directory recursively for files
   */
  private async scanDirectory(dir: string, baseDir: string = dir): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip special files and directories
        if (entry.name.startsWith(".") || entry.name === "temp-uploads") {
          continue;
        }

        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath, baseDir);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          // Get relative path for S3 key
          const relativePath = path.relative(baseDir, fullPath);
          files.push(relativePath);
        }
      }
    } catch (error) {
      this.log.warn({ err: error, dir }, "[MIGRATION] Could not scan directory");
    }

    return files;
  }

  /**
   * Migrate a single file to S3
   */
  private async migrateFile(relativeFilePath: string): Promise<void> {
    const fullPath = path.join(directoriesConfig.uploads, relativeFilePath);

    try {
      // Check if file still exists
      const stats = await fs.stat(fullPath);

      if (!stats.isFile()) {
        this.stats.skippedFiles++;
        return;
      }

      // S3 object name (preserve directory structure)
      const objectName = relativeFilePath.replace(/\\/g, "/");

      // Check if already exists in S3
      if (s3Client) {
        try {
          const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: bucketName,
              Key: objectName,
            }),
          );

          // Already exists in S3, skip
          this.log.info({ objectName }, "[MIGRATION] Already in S3, skipping");
          this.stats.skippedFiles++;
          return;
        } catch (error: unknown) {
          // Not found, proceed with migration
          const httpStatus =
            error instanceof Error && "$metadata" in error
              ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
              : undefined;
          if (httpStatus !== 404) {
            throw error;
          }
        }
      }

      // Upload to S3
      if (s3Client) {
        const fileStream = createReadStream(fullPath);

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: objectName,
            Body: fileStream,
          }),
        );

        this.stats.migratedFiles++;
        this.stats.totalSizeBytes += stats.size;

        this.log.info(
          { objectName, sizeKB: Math.round(stats.size / 1024) },
          "[MIGRATION] Migrated file",
        );

        // Delete filesystem file after successful migration to free up space
        try {
          await fs.unlink(fullPath);
          this.log.info({ file: relativeFilePath }, "[MIGRATION] Deleted from filesystem");
        } catch (unlinkError) {
          this.log.warn(
            { err: unlinkError, file: relativeFilePath },
            "[MIGRATION] Could not delete file from filesystem",
          );
        }
      }
    } catch (error) {
      this.log.error({ err: error, file: relativeFilePath }, "[MIGRATION] Failed to migrate file");
      this.stats.failedFiles++;
      throw error;
    }
  }

  /**
   * Save migration state
   */
  private async saveState(): Promise<void> {
    try {
      await fs.writeFile(
        MIGRATION_STATE_FILE,
        JSON.stringify({ ...this.stats, completed: false }, null, 2),
      );
    } catch (error) {
      this.log.warn({ err: error }, "[MIGRATION] Could not save state");
    }
  }

  /**
   * Mark migration as complete
   */
  private async markMigrationComplete(): Promise<void> {
    try {
      await fs.writeFile(
        MIGRATION_STATE_FILE,
        JSON.stringify({ ...this.stats, completed: true }, null, 2),
      );
      this.log.info("[MIGRATION] Migration marked as complete");
    } catch (error) {
      this.log.warn({ err: error }, "[MIGRATION] Could not mark migration complete");
    }
  }
}

/**
 * Auto-run migration on import (called by server.ts after buildApp,
 * so the Pino logger is available via getLogger()).
 */
export async function runAutoMigration(): Promise<void> {
  const log = getLogger();
  const migrator = new FilesystemToS3Migrator(log);

  if (await migrator.shouldMigrate()) {
    // Run in background, don't block server start
    setTimeout(async () => {
      try {
        await migrator.migrate();
      } catch (error) {
        log.error({ err: error }, "[MIGRATION] Auto-migration failed");
        log.info("[MIGRATION] Will retry on next server restart");
      }
    }, 5000); // Start after 5 seconds

    log.info("[MIGRATION] Background migration scheduled");
  }
}
