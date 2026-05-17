import { describe, expect, it } from "vitest";
import { ClientErrorCodes, formatErrorForDisplay, parseApiError } from "../api-error";

// Mock axios error shape
interface MockAxiosError extends Error {
  isAxiosError: boolean;
  response?: {
    data: Record<string, unknown>;
    status: number;
  };
}

function makeAxiosError(responseData?: Record<string, unknown>, status?: number): MockAxiosError {
  const error = new Error("Request failed") as MockAxiosError;
  error.isAxiosError = true;
  error.response = responseData
    ? { data: responseData, status: status ?? (responseData.statusCode as number) ?? 500 }
    : undefined;
  return error;
}

describe("parseApiError", () => {
  it("parses a standard server error response", () => {
    const error = makeAxiosError({
      error: "File not found",
      code: "NOT_FOUND",
      statusCode: 404,
      timestamp: "2025-01-01T12:00:00.000Z",
    });
    const result = parseApiError(error);
    expect(result.code).toBe("NOT_FOUND");
    expect(result.message).toBe("File not found");
    expect(result.statusCode).toBe(404);
    expect(result.timestamp).toBe("2025-01-01T12:00:00.000Z");
    expect(result.isNetworkError).toBe(false);
  });

  it("detects network errors (no response)", () => {
    const error = makeAxiosError(undefined);
    const result = parseApiError(error);
    expect(result.code).toBe(ClientErrorCodes.NETWORK_ERROR);
    expect(result.statusCode).toBe(0);
    expect(result.isNetworkError).toBe(true);
  });

  it("handles non-axios errors", () => {
    const error = new Error("Something broke");
    const result = parseApiError(error);
    expect(result.code).toBe(ClientErrorCodes.UNKNOWN_ERROR);
    expect(result.message).toBe("Something broke");
    expect(result.isNetworkError).toBe(false);
  });

  it("handles null/undefined errors", () => {
    const result = parseApiError(null);
    expect(result.code).toBe(ClientErrorCodes.UNKNOWN_ERROR);
    expect(result.isNetworkError).toBe(false);
  });

  it("extracts details from response", () => {
    const error = makeAxiosError({
      error: "Too large",
      code: "FILE_SIZE_EXCEEDED",
      statusCode: 400,
      timestamp: "2025-01-01T12:00:00.000Z",
      details: { maxSizeMB: "100" },
    });
    const result = parseApiError(error);
    expect(result.details).toEqual({ maxSizeMB: "100" });
  });

  it("generates timestamp if server didn't provide one", () => {
    const error = makeAxiosError({
      error: "Old format",
      code: "SOME_CODE",
      statusCode: 400,
    });
    const result = parseApiError(error);
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });
});

describe("formatErrorForDisplay", () => {
  it("formats supportRef as CODE • HH:mm:ss", () => {
    const result = formatErrorForDisplay({
      code: "STORAGE_UNREACHABLE",
      message: "Cannot reach storage",
      statusCode: 503,
      timestamp: "2025-06-15T14:32:05.000Z",
      isNetworkError: false,
    });
    // Check format: CODE • HH:mm:ss, allowing for timezone differences
    expect(result.supportRef).toMatch(/^STORAGE_UNREACHABLE • \d{2}:\d{2}:\d{2}$/);
    expect(result.supportRef.startsWith("STORAGE_UNREACHABLE • ")).toBe(true);
  });

  it("uses message as title", () => {
    const result = formatErrorForDisplay({
      code: "NOT_FOUND",
      message: "File not found",
      statusCode: 404,
      timestamp: "2025-01-01T12:00:00.000Z",
      isNetworkError: false,
    });
    expect(result.title).toBe("File not found");
  });
});
