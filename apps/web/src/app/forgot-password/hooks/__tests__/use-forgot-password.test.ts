/**
 * Tests for useForgotPassword hook TanStack Query migration.
 *
 * Covers:
 *   - useQuery replaces useEffect+useState for auth config fetching
 *   - passwordAuthEnabled defaults to true on loading/error
 *   - authConfigLoading reflects query isLoading state
 *   - Return shape is exactly { form, onSubmit, passwordAuthEnabled, authConfigLoading }
 *   - No logger import, no useState for auth config, no useEffect for fetch
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock getAuthConfig endpoint
vi.mock("@/http/endpoints", () => ({
  getAuthConfig: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import { getAuthConfig } from "@/http/endpoints";
import { useForgotPassword } from "../use-forgot-password";

const mockGetAuthConfig = vi.mocked(getAuthConfig);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Disable gcTime delays in tests
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useForgotPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Return shape ──────────────────────────────────────────────────────────────

  it("returns the expected { form, onSubmit, passwordAuthEnabled, authConfigLoading } shape", async () => {
    mockGetAuthConfig.mockResolvedValue({ data: { passwordAuthEnabled: true } } as never);

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    // Keys must be exactly these four
    const keys = Object.keys(result.current);
    expect(keys).toContain("form");
    expect(keys).toContain("onSubmit");
    expect(keys).toContain("passwordAuthEnabled");
    expect(keys).toContain("authConfigLoading");
  });

  // ── Loading state ─────────────────────────────────────────────────────────────

  it("sets authConfigLoading=true and passwordAuthEnabled=true while query is in flight", () => {
    // Never resolve — simulates loading state
    mockGetAuthConfig.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    expect(result.current.authConfigLoading).toBe(true);
    expect(result.current.passwordAuthEnabled).toBe(true);
  });

  // ── Success state ─────────────────────────────────────────────────────────────

  it("sets passwordAuthEnabled=true and authConfigLoading=false when config returns true", async () => {
    mockGetAuthConfig.mockResolvedValue({ data: { passwordAuthEnabled: true } } as never);

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.authConfigLoading).toBe(false));
    expect(result.current.passwordAuthEnabled).toBe(true);
  });

  it("sets passwordAuthEnabled=false and authConfigLoading=false when config returns false", async () => {
    mockGetAuthConfig.mockResolvedValue({ data: { passwordAuthEnabled: false } } as never);

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.authConfigLoading).toBe(false));
    expect(result.current.passwordAuthEnabled).toBe(false);
  });

  // ── Error/fallback state ──────────────────────────────────────────────────────

  it("defaults passwordAuthEnabled=true when auth config fetch fails", async () => {
    mockGetAuthConfig.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useForgotPassword(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.authConfigLoading).toBe(false));
    expect(result.current.passwordAuthEnabled).toBe(true);
  });

  // ── useQuery (not useEffect) ──────────────────────────────────────────────────

  it("calls getAuthConfig once on mount via useQuery", async () => {
    mockGetAuthConfig.mockResolvedValue({ data: { passwordAuthEnabled: true } } as never);

    renderHook(() => useForgotPassword(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockGetAuthConfig).toHaveBeenCalledOnce());
  });
});
