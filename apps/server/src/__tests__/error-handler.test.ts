/**
 * Unit tests for the centralized Fastify error handler.
 *
 * Strategy: construct realistic error objects that pass the real detection
 * functions (no mocking of fastify-type-provider-zod) so the tests verify the
 * real branching logic.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  AppError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/app-error.js";
import {
  type ErrorResponse,
  globalErrorHandler,
  globalNotFoundHandler,
} from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal FastifyRequest mock — only `log.error` is needed. */
function makeRequest() {
  return {
    log: {
      error: vi.fn(),
    },
  };
}

/** Minimal FastifyReply mock supporting `.status().send()` chain. */
function makeReply() {
  const reply = {
    status: vi.fn(),
    send: vi.fn(),
  };
  // .status() returns the same reply object so .send() can be chained
  reply.status.mockReturnValue(reply);
  return reply;
}

/**
 * Invoke globalErrorHandler with test mocks, encapsulating the type casts once.
 *
 * The casts are necessary because test mocks are structural subsets of the
 * real Fastify types. Centralising them here avoids 22+ inline cast sites
 * and prevents index-mismatch bugs (e.g. `Parameters<...>[2]` on a 2-param fn).
 */
function invokeErrorHandler(
  error: unknown,
  request: ReturnType<typeof makeRequest>,
  reply: ReturnType<typeof makeReply>,
): void {
  globalErrorHandler(
    error as FastifyError | Error,
    request as unknown as FastifyRequest,
    reply as unknown as FastifyReply,
  );
}

/**
 * Invoke globalNotFoundHandler with test mocks.
 */
function invokeNotFoundHandler(
  request: ReturnType<typeof makeRequest>,
  reply: ReturnType<typeof makeReply>,
): void {
  globalNotFoundHandler(request as unknown as FastifyRequest, reply as unknown as FastifyReply);
}

/** The Symbol used internally by fastify-type-provider-zod to tag validation items. */
const ZodFastifySchemaValidationErrorSymbol = Symbol.for("ZodFastifySchemaValidationError");

/**
 * Builds a Zod validation error that passes `hasZodFastifySchemaValidationErrors`.
 * Shape is taken directly from fastify-type-provider-zod's `createValidationError`.
 */
function makeZodValidationError(issues: Array<{ path: (string | number)[]; message: string }>) {
  return {
    validation: issues.map((issue) => ({
      [ZodFastifySchemaValidationErrorSymbol]: true,
      keyword: "invalid_type",
      instancePath: `/${issue.path.join("/")}`,
      schemaPath: `#/${issue.path.join("/")}`,
      params: { issue },
      message: issue.message,
    })),
  };
}

/**
 * Builds a Prisma-like error that passes `isPrismaKnownRequestError`.
 */
function makePrismaError(
  code: string,
  meta?: Record<string, unknown>,
): Error & {
  name: string;
  code: string;
  meta?: Record<string, unknown>;
} {
  const err = new Error(`Prisma error ${code}`) as Error & {
    name: string;
    code: string;
    meta?: Record<string, unknown>;
  };
  err.name = "PrismaClientKnownRequestError";
  err.code = code;
  if (meta) err.meta = meta;
  return err;
}

// ---------------------------------------------------------------------------
// 0. AppError domain errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — AppError domain errors", () => {
  it("returns the correct status code and message for AppError", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new AppError(409, "Already exists", "ALREADY_EXISTS");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("ALREADY_EXISTS");
    expect(sent.error).toBe("Already exists");
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("includes details when present", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new ValidationError("Bad input", { fields: ["email"] });

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(400);
    expect(sent.code).toBe("VALIDATION_ERROR");
    expect(sent.details).toEqual({ fields: ["email"] });
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("handles NotFoundError correctly", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new NotFoundError("User not found");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.code).toBe("NOT_FOUND");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("handles UnauthorizedError correctly", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new UnauthorizedError();

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.code).toBe("UNAUTHORIZED");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("handles ForbiddenError correctly", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new ForbiddenError("Not allowed");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.code).toBe("FORBIDDEN");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("handles GoneError correctly", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new GoneError("Resource expired");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(410);
    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.code).toBe("GONE");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("logs the full error via request.log.error", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new NotFoundError("Resource not found");

    invokeErrorHandler(error, request, reply);

    expect(request.log.error).toHaveBeenCalledOnce();
    expect(request.log.error).toHaveBeenCalledWith({ err: error }, "Request error");
  });

  it("includes ISO 8601 timestamp in all error responses", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new AppError(400, "Test error", "TEST_ERROR");

    invokeErrorHandler(error, request, reply);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.timestamp).toBeDefined();
    expect(new Date(sent.timestamp).toISOString()).toBe(sent.timestamp);
  });
});

// ---------------------------------------------------------------------------
// 1. Zod validation errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — Zod validation errors", () => {
  it("returns 400 with VALIDATION_ERROR code and issue details", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makeZodValidationError([
      { path: ["body", "email"], message: "Invalid email" },
      { path: ["body", "name"], message: "Required" },
    ]);

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(400);
    expect(sent.code).toBe("VALIDATION_ERROR");
    expect(sent.error).toBe("Validation Error");
    expect(sent.details?.issues).toEqual([
      { path: "body.email", message: "Invalid email" },
      { path: "body.name", message: "Required" },
    ]);
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("calls request.log.error for every error type (Zod)", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makeZodValidationError([{ path: ["x"], message: "bad" }]);

    invokeErrorHandler(error, request, reply);

    expect(request.log.error).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2. Response serialization errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — response serialization errors", () => {
  it("returns 500 RESPONSE_SERIALIZATION_ERROR without leaking details", () => {
    const request = makeRequest();
    const reply = makeReply();
    // isResponseSerializationError checks `'method' in value`
    const error = {
      method: "GET",
      url: "/api/transfer",
      statusCode: 500,
      message: "Response doesn't match the schema",
    };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("RESPONSE_SERIALIZATION_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 3. JWT authentication errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — JWT errors", () => {
  const jwtCodes = [
    "FST_JWT_NO_AUTHORIZATION_IN_HEADER",
    "FST_JWT_NO_AUTHORIZATION_IN_COOKIE",
    "FST_JWT_AUTHORIZATION_TOKEN_EXPIRED",
    "FST_JWT_AUTHORIZATION_TOKEN_INVALID",
    "FST_JWT_BAD_REQUEST",
    "FST_JWT_BAD_COOKIE_REQUEST",
  ];

  for (const code of jwtCodes) {
    it(`returns 401 for JWT error code: ${code}`, () => {
      const request = makeRequest();
      const reply = makeReply();
      const error = { code, message: "JWT error" };

      invokeErrorHandler(error, request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);

      const sent = reply.send.mock.calls[0][0] as ErrorResponse;
      expect(sent.statusCode).toBe(401);
      expect(sent.code).toBe("AUTHENTICATION_ERROR");
      expect(sent.error).toBe("Unauthorized");
      expect(sent.timestamp).toEqual(expect.any(String));
    });
  }

  it("returns 401 for fast-jwt FAST_JWT_ prefixed codes", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { code: "FAST_JWT_MISSING_SIGNATURE", message: "Unsigned token" };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(401);
    expect(sent.code).toBe("AUTHENTICATION_ERROR");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("returns 401 for unknown future FST_JWT_ codes (prefix-based)", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { code: "FST_JWT_SOME_FUTURE_ERROR", message: "New JWT error" };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(401);
    expect(sent.code).toBe("AUTHENTICATION_ERROR");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("does NOT match errors with JWT-like messages but no FST_JWT_/FAST_JWT_ code", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new Error("Authorization token expired");

    invokeErrorHandler(error, request, reply);

    // Should fall through to the "unknown error" branch (500), not JWT (401)
    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.code).toBe("INTERNAL_ERROR");
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 4. Prisma database errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — Prisma P2002 (unique constraint)", () => {
  it("returns 409 UNIQUE_CONSTRAINT with target field details", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2002", { target: ["email"] });

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("UNIQUE_CONSTRAINT");
    expect(sent.error).toBe("Conflict");
    expect(sent.details?.target).toBe("email");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("uses 'field' as fallback when target is missing", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2002"); // no meta

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.details?.target).toBe("field");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("joins multiple target fields with comma", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2002", { target: ["firstName", "lastName"] });

    invokeErrorHandler(error, request, reply);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.details?.target).toBe("firstName, lastName");
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

describe("globalErrorHandler — Prisma P2025 (record not found)", () => {
  it("returns 404 RECORD_NOT_FOUND", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2025");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(404);
    expect(sent.code).toBe("RECORD_NOT_FOUND");
    expect(sent.error).toBe("Not Found");
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

describe("globalErrorHandler — Prisma P2003 (foreign key constraint)", () => {
  it("returns 409 FOREIGN_KEY_CONSTRAINT", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2003");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("FOREIGN_KEY_CONSTRAINT");
    expect(sent.error).toBe("Conflict");
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

describe("globalErrorHandler — Prisma P2014 (relation violation)", () => {
  it("returns 409 RELATION_VIOLATION", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2014");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("RELATION_VIOLATION");
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

describe("globalErrorHandler — Prisma unknown code (e.g. P9999)", () => {
  it("returns 500 DATABASE_ERROR without leaking Prisma details", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P9999", { someInternalField: "secret" });

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("DATABASE_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    // Must NOT contain any Prisma-internal details
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 5. Fastify 4xx errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — Fastify 4xx errors", () => {
  it("returns correct status and preserves the Fastify message for 400", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 400,
      message: "Bad Request",
      code: "FST_ERR_VALIDATION",
    };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(400);
    expect(sent.code).toBe("FST_ERR_VALIDATION");
    expect(sent.error).toBe("Bad Request");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("returns 403 with Forbidden message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 403,
      message: "Forbidden",
      code: "FST_ERR_FORBIDDEN",
    };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(403);
    expect(sent.error).toBe("Forbidden");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("returns 429 with Too Many Requests message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 429,
      message: "Rate limit exceeded, retry in 1 minute",
      code: "FST_RATE_LIMIT_EXCEEDED",
    };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(429);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(429);
    expect(sent.error).toBe("Rate limit exceeded, retry in 1 minute");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("calls request.log.error for Fastify 4xx errors", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { statusCode: 400, message: "Bad Request", code: "FST_ERR" };

    invokeErrorHandler(error, request, reply);

    expect(request.log.error).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 6. Fastify 5xx errors — must NOT leak internal messages
// ---------------------------------------------------------------------------

describe("globalErrorHandler — Fastify 5xx errors", () => {
  it("returns 503 but replaces message with generic 'Internal Server Error'", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 503,
      message: "Service unavailable: database connection pool exhausted",
      code: "FST_ERR_SERVICE_UNAVAILABLE",
    };

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(503);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(503);
    expect(sent.error).toBe("Internal Server Error");
    // The raw internal message must NOT be forwarded to the client
    expect(sent.error).not.toContain("database");
    expect(sent.error).not.toContain("pool");
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("returns 500 with generic message and logs the full error", () => {
    const request = makeRequest();
    const reply = makeReply();
    const internalError = {
      statusCode: 500,
      message: "Stack overflow in module xyz — line 42",
      code: "FST_ERR_INTERNAL",
    };

    invokeErrorHandler(internalError, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.error).toBe("Internal Server Error");
    // Logged server-side — full error available for debugging
    expect(request.log.error).toHaveBeenCalledOnce();
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 7. Unknown / unexpected errors
// ---------------------------------------------------------------------------

describe("globalErrorHandler — unknown errors", () => {
  it("returns generic 500 INTERNAL_ERROR for plain Error objects", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new Error("something broke internally");

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("INTERNAL_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    // The raw error message must NOT be leaked to the client
    expect(sent.error).not.toContain("something broke");
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("calls request.log.error so the full error is available server-side", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new Error("unexpected");

    invokeErrorHandler(error, request, reply);

    expect(request.log.error).toHaveBeenCalledOnce();
    // Ensure the actual error object is passed so Pino can serialize it
    expect(request.log.error).toHaveBeenCalledWith({ err: error }, "Request error");
  });

  it("returns generic 500 for thrown strings (edge case)", () => {
    const request = makeRequest();
    const reply = makeReply();
    // In some rare cases a non-Error value is thrown
    const error = "some string error";

    invokeErrorHandler(error, request, reply);

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("INTERNAL_ERROR");
    expect(sent.timestamp).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 8. globalNotFoundHandler
// ---------------------------------------------------------------------------

describe("globalNotFoundHandler", () => {
  it("returns 404 NOT_FOUND", () => {
    const request = makeRequest();
    const reply = makeReply();

    invokeNotFoundHandler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(404);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(404);
    expect(sent.code).toBe("NOT_FOUND");
    expect(sent.error).toBe("Not Found");
    expect(sent.details).toBeUndefined();
    expect(sent.timestamp).toEqual(expect.any(String));
  });

  it("does NOT call request.log.error (not an error path)", () => {
    const request = makeRequest();
    const reply = makeReply();

    invokeNotFoundHandler(request, reply);

    expect(request.log.error).not.toHaveBeenCalled();
  });
});
