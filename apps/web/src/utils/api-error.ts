import axios from "axios";

import { logger } from "@/lib/logger";

export const ClientErrorCodes = {
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export interface ApiError {
  /** Machine-readable code from server, or derived client-side */
  code: string;
  /** Human-readable message */
  message: string;
  /** HTTP status (0 for network errors) */
  statusCode: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional structured data from server */
  details?: Record<string, unknown>;
  /** True when server didn't respond at all */
  isNetworkError: boolean;
}

/**
 * Parse any error into a structured ApiError.
 * Handles: Axios errors with response, Axios network errors, standard Errors, and unknown values.
 */
export function parseApiError(error: unknown): ApiError {
  const now = new Date().toISOString();

  // Case 1: Axios error with a response (server responded)
  if (axios.isAxiosError(error) && error.response) {
    const data = error.response.data as Record<string, unknown> | undefined;
    const serverCode = typeof data?.code === "string" ? data.code : "";
    if (!serverCode) {
      logger.warn("[parseApiError] Server returned empty or missing error code", {
        status: error.response.status,
        url: error.config?.url,
      });
    }
    return {
      code: serverCode || ClientErrorCodes.UNKNOWN_ERROR,
      message: (typeof data?.error === "string" && data.error) || error.message || "Request failed",
      statusCode: error.response.status,
      timestamp: (typeof data?.timestamp === "string" && data.timestamp) || now,
      details:
        typeof data?.details === "object" && data.details !== null
          ? (data.details as Record<string, unknown>)
          : undefined,
      isNetworkError: false,
    };
  }

  // Case 2: Axios error without response (network error)
  if (axios.isAxiosError(error) && !error.response) {
    return {
      code: ClientErrorCodes.NETWORK_ERROR,
      message: "Unable to reach the server. Please check your connection.",
      statusCode: 0,
      timestamp: now,
      isNetworkError: true,
    };
  }

  // Case 3: Standard Error
  if (error instanceof Error) {
    return {
      code: ClientErrorCodes.UNKNOWN_ERROR,
      message: error.message || "An unexpected error occurred",
      statusCode: 0,
      timestamp: now,
      isNetworkError: false,
    };
  }

  // Case 4: Unknown value
  return {
    code: ClientErrorCodes.UNKNOWN_ERROR,
    message: "An unexpected error occurred",
    statusCode: 0,
    timestamp: now,
    isNetworkError: false,
  };
}

/**
 * Format an ApiError for user display.
 * Returns a title (human message) and supportRef (code + time for bug reports).
 */
export function formatErrorForDisplay(apiError: ApiError): {
  title: string;
  supportRef: string;
} {
  const time = formatTime(apiError.timestamp);
  const supportRef = `${apiError.code} • ${time}`;

  return {
    title: apiError.message,
    supportRef,
  };
}

function formatTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "??:??:??";
  }
}
