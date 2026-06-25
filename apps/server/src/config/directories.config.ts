import * as path from "node:path";

import { IS_RUNNING_IN_CONTAINER } from "../utils/container-detection.js";

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
