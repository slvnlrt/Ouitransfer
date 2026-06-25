import type { FastifyBaseLogger } from "fastify";

// Module-level logger placeholder — set by app initialization
let _logger: FastifyBaseLogger | null = null;

export function setLogger(logger: FastifyBaseLogger): void {
  _logger = logger;
}

export function getLogger(): FastifyBaseLogger {
  if (!_logger) {
    // Fallback before app initialization (should rarely happen)
    throw new Error("Logger not initialized. Call setLogger() during app setup.");
  }
  return _logger;
}
