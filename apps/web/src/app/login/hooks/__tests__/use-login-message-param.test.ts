/**
 * @vitest-environment jsdom
 *
 * Tests that use-login.ts never renders a free-form `message` URL param in a
 * toast (A7-08) — error toasts come exclusively from i18n-mapped `error` codes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  toast: { error: vi.fn(), success: vi.fn() },
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

describe("useLogin — message param is NOT rendered (A7-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSearchParamsMap = {};
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

  it("renders the i18n-mapped error code, NOT the attacker-supplied message", async () => {
    mockSearchParamsMap = {
      error: "oauth_failed",
      message: "Your account was compromised, call 1-800-EVIL",
    };

    renderHook(() => useLogin(), { wrapper: createWrapper() });
    vi.advanceTimersByTime(150);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("auth.errors.oauth_failed");
    expect(toast.error).not.toHaveBeenCalledWith("Your account was compromised, call 1-800-EVIL");
  });

  it("shows no toast when only a message param is present (no error code)", async () => {
    mockSearchParamsMap = { message: "Arbitrary phishing text" };

    renderHook(() => useLogin(), { wrapper: createWrapper() });
    vi.advanceTimersByTime(150);

    expect(toast.error).not.toHaveBeenCalled();
  });
});
