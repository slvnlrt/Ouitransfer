/**
 * Default database URL — CWD-relative path used in development.
 * In Docker, DATABASE_URL is set explicitly via server-start.sh.
 *
 * Extracted into its own file so prisma.config.ts can import it
 * without triggering a load of the generated Prisma client
 * (which doesn't exist yet at `prisma generate` time).
 */
export const DEFAULT_DATABASE_URL = "file:./prisma/ouitransfer.db";
