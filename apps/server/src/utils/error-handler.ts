import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "@fastify/type-provider-zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./app-error.js";

/**
 * Standard error response shape returned by all error paths.
 * All controllers use AppError subclasses — the globalErrorHandler is the
 * single place that maps these to HTTP responses.
 */
export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Prisma error handling
// ---------------------------------------------------------------------------

interface PrismaKnownError {
  code: string;
  meta?: Record<string, unknown>;
}

/**
 * Prisma errors are imported from `@prisma/client/runtime/library`,
 * but we detect them structurally to avoid a hard import dependency.
 */
function isPrismaKnownRequestError(error: unknown): error is PrismaKnownError {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: string }).name;
  // Prisma's PrismaClientKnownRequestError, PrismaClientValidationError, etc.
  return (
    (name === "PrismaClientKnownRequestError" || name === "PrismaClientValidationError") &&
    typeof (error as PrismaKnownError).code === "string"
  );
}

function handlePrismaError(error: PrismaKnownError): ErrorResponse {
  switch (error.code) {
    case "P2002": {
      // Unique constraint violation
      const target = (error.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return {
        error: "Conflict",
        code: ErrorCodes.UNIQUE_CONSTRAINT,
        statusCode: 409,
        timestamp: new Date().toISOString(),
        details: { target },
      };
    }
    case "P2025":
      // Record not found
      return {
        error: "Not Found",
        code: ErrorCodes.RECORD_NOT_FOUND,
        statusCode: 404,
        timestamp: new Date().toISOString(),
      };
    case "P2003":
      // Foreign key constraint violation
      return {
        error: "Conflict",
        code: ErrorCodes.FOREIGN_KEY_CONSTRAINT,
        statusCode: 409,
        timestamp: new Date().toISOString(),
      };
    case "P2014":
      // Relation violation
      return {
        error: "Conflict",
        code: ErrorCodes.RELATION_VIOLATION,
        statusCode: 409,
        timestamp: new Date().toISOString(),
      };
    default:
      return {
        error: "Internal Server Error",
        code: ErrorCodes.DATABASE_ERROR,
        statusCode: 500,
        timestamp: new Date().toISOString(),
      };
  }
}

// ---------------------------------------------------------------------------
// Zod validation error handling
// ---------------------------------------------------------------------------

function handleZodValidationError(
  error: Parameters<typeof hasZodFastifySchemaValidationErrors>[0] & {
    validation: Array<{
      keyword: string;
      instancePath: string;
      message: string;
      params: Record<string, unknown>;
    }>;
  },
): ErrorResponse {
  const issues = error.validation.map((v) => ({
    path: v.instancePath.replace(/^\//, "").replaceAll("/", ".") || "unknown",
    message: v.message,
  }));

  return {
    error: "Validation Error",
    code: ErrorCodes.VALIDATION_ERROR,
    statusCode: 400,
    timestamp: new Date().toISOString(),
    details: { issues },
  };
}

// ---------------------------------------------------------------------------
// JWT error handling
// ---------------------------------------------------------------------------

function isJwtError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  if (typeof code !== "string") return false;
  // @fastify/jwt errors use FST_JWT_ prefix (e.g. FST_JWT_AUTHORIZATION_TOKEN_EXPIRED).
  // fast-jwt (underlying library) uses FAST_JWT_ prefix (e.g. FAST_JWT_MISSING_SIGNATURE).
  // Prefix-based detection is future-proof: new error codes are caught automatically.
  return code.startsWith("FST_JWT_") || code.startsWith("FAST_JWT_");
}

// ---------------------------------------------------------------------------
// Main error handler
// ---------------------------------------------------------------------------

/**
 * Centralized Fastify error handler.
 *
 * - Logs the full error server-side via Pino (`request.log`)
 * - Returns a consistent `ErrorResponse` shape to the client
 * - NEVER leaks stack traces or raw error messages for unknown errors
 */
export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Always log the full error for debugging (Pino serializes it properly)
  request.log.error({ err: error }, "Request error");

  let response: ErrorResponse;

  // 0. AppError — domain errors from controllers/services (most common path)
  // Convention: AppError messages are always client-safe.
  if (error instanceof AppError) {
    response = {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString(),
      ...(error.details ? { details: error.details } : {}),
    };
    reply.status(response.statusCode).send(response);
    return;
  }

  // 1. Zod validation errors (from fastify-type-provider-zod)
  if (hasZodFastifySchemaValidationErrors(error)) {
    response = handleZodValidationError(
      error as unknown as Parameters<typeof handleZodValidationError>[0],
    );
    reply.status(response.statusCode).send(response);
    return;
  }

  // 2. Response serialization errors (schema mismatch in response)
  // Guard: isResponseSerializationError uses `'method' in value` which throws on primitives
  if (typeof error === "object" && error !== null && isResponseSerializationError(error)) {
    // This is a server-side bug — don't expose details to client
    response = {
      error: "Internal Server Error",
      code: ErrorCodes.RESPONSE_SERIALIZATION_ERROR,
      statusCode: 500,
      timestamp: new Date().toISOString(),
    };
    reply.status(response.statusCode).send(response);
    return;
  }

  // 3. JWT authentication errors
  if (isJwtError(error)) {
    response = {
      error: "Unauthorized",
      code: ErrorCodes.AUTHENTICATION_ERROR,
      statusCode: 401,
      timestamp: new Date().toISOString(),
    };
    reply.status(response.statusCode).send(response);
    return;
  }

  // 4. Prisma database errors
  if (isPrismaKnownRequestError(error)) {
    response = handlePrismaError(error);
    reply.status(response.statusCode).send(response);
    return;
  }

  // 5. Fastify errors with an explicit statusCode (rate-limit, content-type, etc.)
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 600) {
    response = {
      error: fastifyError.message || http4xxMessage(fastifyError.statusCode),
      code: fastifyError.code || ErrorCodes.FASTIFY_ERROR,
      statusCode: fastifyError.statusCode,
      timestamp: new Date().toISOString(),
    };

    // For 4xx client errors, forward the (already-sanitized Fastify) message.
    // For 5xx server errors, use a generic message to avoid leaking internals.
    if (fastifyError.statusCode >= 500) {
      response.error = "Internal Server Error";
    }

    reply.status(response.statusCode).send(response);
    return;
  }

  // 6. Unknown / unexpected errors — generic 500
  response = {
    error: "Internal Server Error",
    code: ErrorCodes.INTERNAL_ERROR,
    statusCode: 500,
    timestamp: new Date().toISOString(),
  };
  reply.status(response.statusCode).send(response);
}

// ---------------------------------------------------------------------------
// Not-found handler
// ---------------------------------------------------------------------------

/**
 * Centralized 404 handler for routes that don't exist.
 */
export function globalNotFoundHandler(_request: FastifyRequest, reply: FastifyReply): void {
  const response: ErrorResponse = {
    error: "Not Found",
    code: ErrorCodes.NOT_FOUND,
    statusCode: 404,
    timestamp: new Date().toISOString(),
  };
  reply.status(404).send(response);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function http4xxMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
  };
  return messages[statusCode] ?? "Client Error";
}
