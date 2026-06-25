import { ErrorCodes } from "@ouitransfer/shared/error-codes";

/**
 * Domain-specific error classes for Ouitransfer.
 *
 * Convention: AppError messages are ALWAYS client-safe. Never construct
 * them from raw error.message or error.toString() — those may contain
 * internal details. Use a hardcoded, user-friendly message instead.
 *
 * Throw from controllers and services. The globalErrorHandler catches
 * these and returns a consistent ErrorResponse shape.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, message, ErrorCodes.NOT_FOUND);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, message, ErrorCodes.VALIDATION_ERROR, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(403, message, ErrorCodes.FORBIDDEN);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, ErrorCodes.UNAUTHORIZED);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, ErrorCodes.CONFLICT);
  }
}

export class GoneError extends AppError {
  constructor(message: string) {
    super(410, message, ErrorCodes.GONE);
  }
}
