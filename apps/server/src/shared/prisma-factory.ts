import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";
import { DEFAULT_DATABASE_URL } from "./prisma-constants.js";

export { DEFAULT_DATABASE_URL };

/**
 * Create a PrismaClient wired to better-sqlite3.
 * Wraps adapter construction with a helpful error message for native-module failures.
 */
export function createPrismaClient(url?: string): PrismaClient {
  const dbUrl = url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  try {
    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    return new PrismaClient({ adapter });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize Prisma client (url: ${dbUrl}). ` +
        `If better-sqlite3 failed to load, run 'npm rebuild better-sqlite3'. ` +
        `Original error: ${message}`,
    );
  }
}
