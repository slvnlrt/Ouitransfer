/**
 * Tests for the reportError() utility.
 *
 * Covers:
 *   - Error instances logged with message + stack
 *   - String errors normalised to Error objects
 *   - Non-string/non-Error values (number, null) normalised to Error objects
 *   - Extra context fields merged into the log call
 *   - Works correctly without a context argument
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger module *before* importing reportError so the module sees the mock.
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import AFTER vi.mock so the hoisting works correctly.
import { logger } from "@/lib/logger";
import { type ErrorContext, reportError } from "@/lib/report-error";

const mockLoggerError = vi.mocked(logger.error);

// ── Test suite ────────────────────────────────────────────────────────────────

describe("reportError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Error instance ──────────────────────────────────────────────────────────

  it("logs an Error instance with its message and stack", () => {
    const error = new Error("something broke");

    reportError(error);

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [message, context] = mockLoggerError.mock.calls[0];
    expect(message).toBe("Unhandled error");
    expect(context).toMatchObject({
      err: "something broke",
      stack: error.stack,
    });
  });

  // 2. String error ────────────────────────────────────────────────────────────

  it("normalises a string error to an Error and logs its message", () => {
    reportError("network timeout");

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [, context] = mockLoggerError.mock.calls[0];
    expect(context).toMatchObject({ err: "network timeout" });
    // Stack should be present (created internally as new Error("network timeout"))
    expect(typeof context?.stack).toBe("string");
  });

  // 3. Non-string / non-Error values ───────────────────────────────────────────

  it("normalises a numeric error value to an Error string representation", () => {
    reportError(42);

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [, context] = mockLoggerError.mock.calls[0];
    expect(context).toMatchObject({ err: "42" });
  });

  it("normalises null to an Error and logs 'null' as the message", () => {
    reportError(null);

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [, context] = mockLoggerError.mock.calls[0];
    expect(context).toMatchObject({ err: "null" });
  });

  it("normalises an object to an Error via String() conversion", () => {
    reportError({ code: "ERR_NETWORK" });

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [, context] = mockLoggerError.mock.calls[0];
    // String({code:"ERR_NETWORK"}) → "[object Object]"
    expect(context).toMatchObject({ err: "[object Object]" });
  });

  // 4. Context merging ──────────────────────────────────────────────────────────

  it("merges context fields into the log call alongside err and stack", () => {
    const context: ErrorContext = { source: "ErrorBoundary", route: "/dashboard" };

    reportError(new Error("ctx error"), context);

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [message, loggedContext] = mockLoggerError.mock.calls[0];
    expect(message).toBe("Unhandled error");
    expect(loggedContext).toMatchObject({
      err: "ctx error",
      source: "ErrorBoundary",
      route: "/dashboard",
    });
  });

  it("merges arbitrary extra fields from context", () => {
    reportError(new Error("extra"), { userId: "u-123", requestId: "req-456" });

    const [, ctx] = mockLoggerError.mock.calls[0];
    expect(ctx).toMatchObject({ userId: "u-123", requestId: "req-456" });
  });

  // 5. No context argument ──────────────────────────────────────────────────────

  it("works correctly when called without a context argument", () => {
    expect(() => reportError(new Error("no context"))).not.toThrow();
    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [message, context] = mockLoggerError.mock.calls[0];
    expect(message).toBe("Unhandled error");
    expect(context).toHaveProperty("err");
    expect(context).toHaveProperty("stack");
  });
});
