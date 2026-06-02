/**
 * @vitest-environment jsdom
 *
 * Tests for ACCOUNT_LOCKED error handling in use-login.ts.
 * When the server returns ACCOUNT_LOCKED, the frontend shows a user-friendly
 * lockout message with the remaining minutes, distinct from other errors.
 */

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so mockLogin and mockParseApiError are available inside the
// hoisted vi.mock factories (vi.mock calls are hoisted to the top of the file).
const { mockLogin, mockParseApiError } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockParseApiError: vi.fn(),
}));

let mockSearchParamsMap: Record<string, string | null> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsMap[key] ?? null,
  }),
}));

// Track the last t() call key and params to assert correct translation usage
let lastTCall: { key: string; params?: Record<string, unknown> } | null = null;
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    lastTCall = { key, params };
    return key;
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/http/endpoints", () => ({
  getAuthConfig: vi.fn().mockResolvedValue({ data: { passwordAuthEnabled: true } }),
  login: mockLogin,
}));

vi.mock("@/http/endpoints/auth/two-factor", () => ({
  completeTwoFactorLogin: vi.fn(),
}));

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    auth: {
      config: () => ["auth", "config"],
      currentUser: () => ["auth", "currentUser"],
    },
  },
}));

// Mock parseApiError directly so we can control what it returns per test
vi.mock("@/utils/api-error", () => ({
  parseApiError: mockParseApiError,
}));

import { useLogin } from "../use-login";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeApiError(
  code: string,
  options: { remainingMinutes?: number; isNetworkError?: boolean } = {},
) {
  return {
    code,
    message: "server error",
    statusCode: 403,
    timestamp: new Date().toISOString(),
    details:
      options.remainingMinutes !== undefined
        ? { remainingMinutes: options.remainingMinutes }
        : undefined,
    isNetworkError: options.isNetworkError ?? false,
  };
}

describe("useLogin — ACCOUNT_LOCKED error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSearchParamsMap = {};
    lastTCall = null;

    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/login", pathname: "/login" },
      writable: true,
      configurable: true,
    });
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses errors.accountLocked translation key for ACCOUNT_LOCKED error", async () => {
    mockLogin.mockRejectedValue(new Error("403"));
    mockParseApiError.mockReturnValue(
      makeApiError(ErrorCodes.ACCOUNT_LOCKED, { remainingMinutes: 12 }),
    );

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "wrong-pass",
      });
    });

    expect(result.current.error).toBeDefined();
    expect(lastTCall?.key).toBe("errors.accountLocked");
  });

  it("passes remainingMinutes from server details to the translation function", async () => {
    mockLogin.mockRejectedValue(new Error("403"));
    mockParseApiError.mockReturnValue(
      makeApiError(ErrorCodes.ACCOUNT_LOCKED, { remainingMinutes: 7 }),
    );

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "wrong",
      });
    });

    expect(lastTCall?.key).toBe("errors.accountLocked");
    expect(lastTCall?.params).toEqual({ minutes: 7 });
  });

  it("falls back to minutes=15 when details.remainingMinutes is absent", async () => {
    mockLogin.mockRejectedValue(new Error("403"));
    // No remainingMinutes in details → details is undefined
    mockParseApiError.mockReturnValue({
      ...makeApiError(ErrorCodes.ACCOUNT_LOCKED),
      details: undefined,
    });

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "wrong",
      });
    });

    expect(lastTCall?.key).toBe("errors.accountLocked");
    expect(lastTCall?.params).toEqual({ minutes: 15 });
  });

  it("does NOT use errors.invalidCredentials or errors.unexpectedError for ACCOUNT_LOCKED", async () => {
    mockLogin.mockRejectedValue(new Error("403"));
    mockParseApiError.mockReturnValue(
      makeApiError(ErrorCodes.ACCOUNT_LOCKED, { remainingMinutes: 5 }),
    );

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "wrong",
      });
    });

    expect(lastTCall?.key).not.toBe("errors.invalidCredentials");
    expect(lastTCall?.key).not.toBe("errors.unexpectedError");
    expect(lastTCall?.key).not.toBe("errors.networkError");
  });

  it("shows invalidCredentials for VALIDATION_ERROR (B-7 — no password policy leak)", async () => {
    mockLogin.mockRejectedValue(new Error("400"));
    mockParseApiError.mockReturnValue({
      ...makeApiError(ErrorCodes.VALIDATION_ERROR),
      statusCode: 400,
    });

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "short",
      });
    });

    expect(lastTCall?.key).toBe("errors.invalidCredentials");
  });

  it("still shows errors.invalidCredentials for UNAUTHORIZED errors (regression)", async () => {
    mockLogin.mockRejectedValue(new Error("401"));
    mockParseApiError.mockReturnValue({
      ...makeApiError(ErrorCodes.UNAUTHORIZED),
      statusCode: 401,
    });

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.onSubmit({
        emailOrUsername: "user@test.com",
        password: "wrong",
      });
    });

    expect(lastTCall?.key).toBe("errors.invalidCredentials");
  });
});
