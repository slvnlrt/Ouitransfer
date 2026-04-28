import { logger } from "@/lib/logger";

export interface ErrorContext {
  /** Which error boundary or handler caught this */
  source?: string;
  /** Route or page identifier */
  route?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error("Unhandled error", {
    err: err.message,
    stack: err.stack,
    ...context,
  });
}
