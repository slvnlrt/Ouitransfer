/**
 * Unit tests for the centralized Fastify error handler.
 *
 * Strategy: construct realistic error objects that pass the real detection
 * functions (no mocking of fastify-type-provider-zod) so the tests verify the
 * real branching logic.
 */
import { describe, expect, it, vi } from "vitest";

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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(400);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(400);
    expect(sent.code).toBe("VALIDATION_ERROR");
    expect(sent.error).toBe("Validation Error");
    expect(sent.details?.issues).toEqual([
      { path: "body.email", message: "Invalid email" },
      { path: "body.name", message: "Required" },
    ]);
  });

  it("calls request.log.error for every error type (Zod)", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makeZodValidationError([{ path: ["x"], message: "bad" }]);

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("RESPONSE_SERIALIZATION_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    expect(sent.details).toBeUndefined();
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

      globalErrorHandler(
        error as unknown as Parameters<typeof globalErrorHandler>[0],
        request as unknown as Parameters<typeof globalErrorHandler>[1],
        reply as unknown as Parameters<typeof globalErrorHandler>[2],
      );

      expect(reply.status).toHaveBeenCalledWith(401);

      const sent = reply.send.mock.calls[0][0] as ErrorResponse;
      expect(sent.statusCode).toBe(401);
      expect(sent.code).toBe("AUTHENTICATION_ERROR");
      expect(sent.error).toBe("Unauthorized");
    });
  }

  it("returns 401 for generic 'Authorization token expired' message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { message: "Authorization token expired" };

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(401);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(401);
    expect(sent.code).toBe("AUTHENTICATION_ERROR");
  });

  it("returns 401 for generic 'Authorization token is invalid' message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { message: "Authorization token is invalid" };

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(401);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(401);
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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("UNIQUE_CONSTRAINT");
    expect(sent.error).toBe("Conflict");
    expect(sent.details?.target).toBe("email");
  });

  it("uses 'field' as fallback when target is missing", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2002"); // no meta

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.details?.target).toBe("field");
  });

  it("joins multiple target fields with comma", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2002", { target: ["firstName", "lastName"] });

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.details?.target).toBe("firstName, lastName");
  });
});

describe("globalErrorHandler — Prisma P2025 (record not found)", () => {
  it("returns 404 RECORD_NOT_FOUND", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2025");

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(404);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(404);
    expect(sent.code).toBe("RECORD_NOT_FOUND");
    expect(sent.error).toBe("Not Found");
    expect(sent.details).toBeUndefined();
  });
});

describe("globalErrorHandler — Prisma P2003 (foreign key constraint)", () => {
  it("returns 409 FOREIGN_KEY_CONSTRAINT", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2003");

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("FOREIGN_KEY_CONSTRAINT");
    expect(sent.error).toBe("Conflict");
  });
});

describe("globalErrorHandler — Prisma P2014 (relation violation)", () => {
  it("returns 409 RELATION_VIOLATION", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P2014");

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(409);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(409);
    expect(sent.code).toBe("RELATION_VIOLATION");
  });
});

describe("globalErrorHandler — Prisma unknown code (e.g. P9999)", () => {
  it("returns 500 DATABASE_ERROR without leaking Prisma details", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = makePrismaError("P9999", { someInternalField: "secret" });

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("DATABASE_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    // Must NOT contain any Prisma-internal details
    expect(sent.details).toBeUndefined();
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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(400);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(400);
    expect(sent.code).toBe("FST_ERR_VALIDATION");
    expect(sent.error).toBe("Bad Request");
  });

  it("returns 403 with Forbidden message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 403,
      message: "Forbidden",
      code: "FST_ERR_FORBIDDEN",
    };

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(403);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(403);
    expect(sent.error).toBe("Forbidden");
  });

  it("returns 429 with Too Many Requests message", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = {
      statusCode: 429,
      message: "Rate limit exceeded, retry in 1 minute",
      code: "FST_RATE_LIMIT_EXCEEDED",
    };

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(429);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(429);
    expect(sent.error).toBe("Rate limit exceeded, retry in 1 minute");
  });

  it("calls request.log.error for Fastify 4xx errors", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = { statusCode: 400, message: "Bad Request", code: "FST_ERR" };

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(503);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(503);
    expect(sent.error).toBe("Internal Server Error");
    // The raw internal message must NOT be forwarded to the client
    expect(sent.error).not.toContain("database");
    expect(sent.error).not.toContain("pool");
  });

  it("returns 500 with generic message and logs the full error", () => {
    const request = makeRequest();
    const reply = makeReply();
    const internalError = {
      statusCode: 500,
      message: "Stack overflow in module xyz — line 42",
      code: "FST_ERR_INTERNAL",
    };

    globalErrorHandler(
      internalError as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.error).toBe("Internal Server Error");
    // Logged server-side — full error available for debugging
    expect(request.log.error).toHaveBeenCalledOnce();
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

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("INTERNAL_ERROR");
    expect(sent.error).toBe("Internal Server Error");
    // The raw error message must NOT be leaked to the client
    expect(sent.error).not.toContain("something broke");
    expect(sent.details).toBeUndefined();
  });

  it("calls request.log.error so the full error is available server-side", () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = new Error("unexpected");

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(request.log.error).toHaveBeenCalledOnce();
    // Ensure the actual error object is passed so Pino can serialize it
    expect(request.log.error).toHaveBeenCalledWith({ err: error }, "Request error");
  });

  it("returns generic 500 for thrown strings (edge case)", () => {
    const request = makeRequest();
    const reply = makeReply();
    // In some rare cases a non-Error value is thrown
    const error = "some string error" as unknown as Error;

    globalErrorHandler(
      error as unknown as Parameters<typeof globalErrorHandler>[0],
      request as unknown as Parameters<typeof globalErrorHandler>[1],
      reply as unknown as Parameters<typeof globalErrorHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(500);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(500);
    expect(sent.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// 8. globalNotFoundHandler
// ---------------------------------------------------------------------------

describe("globalNotFoundHandler", () => {
  it("returns 404 NOT_FOUND", () => {
    const request = makeRequest();
    const reply = makeReply();

    globalNotFoundHandler(
      request as unknown as Parameters<typeof globalNotFoundHandler>[0],
      reply as unknown as Parameters<typeof globalNotFoundHandler>[2],
    );

    expect(reply.status).toHaveBeenCalledWith(404);

    const sent = reply.send.mock.calls[0][0] as ErrorResponse;
    expect(sent.statusCode).toBe(404);
    expect(sent.code).toBe("NOT_FOUND");
    expect(sent.error).toBe("Not Found");
    expect(sent.details).toBeUndefined();
  });

  it("does NOT call request.log.error (not an error path)", () => {
    const request = makeRequest();
    const reply = makeReply();

    globalNotFoundHandler(
      request as unknown as Parameters<typeof globalNotFoundHandler>[0],
      reply as unknown as Parameters<typeof globalNotFoundHandler>[2],
    );

    expect(request.log.error).not.toHaveBeenCalled();
  });
});
