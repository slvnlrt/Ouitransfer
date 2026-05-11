import crypto from "node:crypto";
import * as path from "node:path";

import { IS_RUNNING_IN_CONTAINER } from "../utils/container-detection.js";
import { sanitizeFilename } from "../utils/sanitize-filename.js";

/**
 * Directory Configuration for OUITRANSFER Server
 *
 * This configuration manages all directory paths used by the server,
 * including temporary directories for uploads.
 */

export interface DirectoryConfig {
  baseDir: string;
  uploads: string;
  tempUploads: string;
}

const BASE_DIR = IS_RUNNING_IN_CONTAINER ? "/app/server" : process.cwd();

export const directoriesConfig: DirectoryConfig = {
  baseDir: BASE_DIR,
  uploads: path.join(BASE_DIR, "uploads"),
  tempUploads: path.join(BASE_DIR, "temp-uploads"),
};

/**
 * Get the temporary directory for upload operations
 * This is where files are temporarily stored during streaming uploads
 */
export function getTempUploadDir(): string {
  return directoriesConfig.tempUploads;
}

/**
 * Get the uploads directory
 * This is where final files are stored
 */
export function getUploadsDir(): string {
  return directoriesConfig.uploads;
}

/**
 * Get temporary path for a file during upload
 * This ensures unique temporary file names to avoid conflicts
 * Files are stored directly in temp-uploads with timestamp + random suffix
 */
export function getTempFilePath(objectName: string): string {
  // Use the basename of the objectName (strip S3 path prefixes like "userId/...") then sanitize
  const basename = objectName.split("/").pop() ?? objectName;
  const sanitizedName = sanitizeFilename(basename);
  const timestamp = Date.now();
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  return path.join(getTempUploadDir(), `${timestamp}-${randomSuffix}-${sanitizedName}.tmp`);
}
