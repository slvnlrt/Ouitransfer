/**
 * @vitest-environment jsdom
 *
 * Tests for the session expired toast in use-login.ts.
 * When `?reason=session_expired` is present in the URL, a translated toast is shown.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track searchParams.get calls
let mockSearchParamsMap: Record<string, string | null> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsMap[key] ?? null,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/http/endpoints", () => ({
  getAuthConfig: vi.fn().mockResolvedValue({ data: { passwordAuthEnabled: true } }),
  login: vi.fn(),
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

import { useLogin } from "../use-login";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useLogin — session expired toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSearchParamsMap = {};

    // Provide a minimal window.location for replaceState calls
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

  it("shows session expired toast when ?reason=session_expired is present", async () => {
    mockSearchParamsMap = { reason: "session_expired" };

    renderHook(() => useLogin(), { wrapper: createWrapper() });

    // The toast is shown via setTimeout(..., 100)
    vi.advanceTimersByTime(150);

    expect(toast.error).toHaveBeenCalledWith("auth.sessionExpired");
  });

  it("cleans up the reason param from the URL after showing toast", async () => {
    mockSearchParamsMap = { reason: "session_expired" };

    renderHook(() => useLogin(), { wrapper: createWrapper() });

    // First timeout shows toast (100ms), second cleans URL (1000ms)
    vi.advanceTimersByTime(1100);

    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it("does NOT show session expired toast when reason param is absent", async () => {
    mockSearchParamsMap = {};

    renderHook(() => useLogin(), { wrapper: createWrapper() });

    vi.advanceTimersByTime(1100);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does NOT show session expired toast for other reason values", async () => {
    mockSearchParamsMap = { reason: "other_reason" };

    renderHook(() => useLogin(), { wrapper: createWrapper() });

    vi.advanceTimersByTime(1100);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows both session expired toast AND error toast when both params present", async () => {
    mockSearchParamsMap = { reason: "session_expired", error: "auth_failed" };

    renderHook(() => useLogin(), { wrapper: createWrapper() });

    vi.advanceTimersByTime(1100);

    // Should show both toasts
    expect(toast.error).toHaveBeenCalledWith("auth.sessionExpired");
    expect(toast.error).toHaveBeenCalledWith("auth.errors.auth_failed");
  });
});
