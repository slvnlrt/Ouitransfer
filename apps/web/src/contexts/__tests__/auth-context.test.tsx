import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/query-keys";
import { AuthProvider, useAuth } from "../auth-context";

// Mock the endpoint modules
vi.mock("@/http/endpoints", () => ({
  getAppInfo: vi.fn(),
  getCurrentUser: vi.fn(),
}));

import { getAppInfo, getCurrentUser } from "@/http/endpoints";

const mockGetAppInfo = vi.mocked(getAppInfo);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  };
}

describe("AuthProvider", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("starts with null state while loading", () => {
    // Simulate pending queries — never resolve
    mockGetAppInfo.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBeNull();
    expect(result.current.isAdmin).toBeNull();
  });

  it("derives authenticated state from query data", async () => {
    const mockUser = {
      id: "u1",
      firstName: "John",
      lastName: "Doe",
      username: "johndoe",
      email: "john@test.com",
      isAdmin: false,
      isActive: true,
      image: "avatar.png",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };

    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: false,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    mockGetCurrentUser.mockResolvedValue({
      data: { user: mockUser },
    } as ReturnType<typeof getCurrentUser> extends Promise<infer R> ? R : never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.user).toEqual({
      id: "u1",
      firstName: "John",
      lastName: "Doe",
      username: "johndoe",
      email: "john@test.com",
      isActive: true,
      image: "avatar.png",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    });
    expect(result.current.isAdmin).toBe(false);
  });

  it("derives admin state correctly", async () => {
    const mockUser = {
      id: "u2",
      firstName: "Admin",
      lastName: "User",
      username: "admin",
      email: "admin@test.com",
      isAdmin: true,
      isActive: true,
      image: null,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };

    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: false,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    mockGetCurrentUser.mockResolvedValue({
      data: { user: mockUser },
    } as ReturnType<typeof getCurrentUser> extends Promise<infer R> ? R : never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(true);
    });

    expect(result.current.isAuthenticated).toBe(true);
  });

  it("sets unauthenticated on firstUserAccess", async () => {
    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: true,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    // getCurrentUser should not be called when firstUserAccess is true
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it("sets unauthenticated on app info error", async () => {
    mockGetAppInfo.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it("sets unauthenticated on getCurrentUser error", async () => {
    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: false,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    mockGetCurrentUser.mockRejectedValue(new Error("401 Unauthorized"));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it("does not expose setter functions", () => {
    mockGetAppInfo.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    // The context should only expose reader fields + logout
    const keys = Object.keys(result.current);
    expect(keys).toContain("user");
    expect(keys).toContain("isAuthenticated");
    expect(keys).toContain("isAdmin");
    expect(keys).toContain("logout");
    expect(keys).not.toContain("setUser");
    expect(keys).not.toContain("setIsAuthenticated");
    expect(keys).not.toContain("setIsAdmin");
  });

  it("logout removes both currentUser and app.info queries", async () => {
    const mockUser = {
      id: "u1",
      firstName: "John",
      lastName: "Doe",
      username: "johndoe",
      email: "john@test.com",
      isAdmin: false,
      isActive: true,
      image: null,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };

    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: false,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    mockGetCurrentUser.mockResolvedValue({
      data: { user: mockUser },
    } as ReturnType<typeof getCurrentUser> extends Promise<infer R> ? R : never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    // Wait for authenticated state
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    // Verify data is in cache before logout
    expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toBeDefined();
    expect(queryClient.getQueryData(queryKeys.app.info())).toBeDefined();

    // Call logout
    act(() => {
      result.current.logout();
    });

    // Both queries should be removed from cache
    // (Derived state transitions to unauthenticated via the same path tested in
    // "unauthenticated on getCurrentUser error" — TQ refetch timing makes
    // asserting the transition in this test flaky)
    expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.app.info())).toBeUndefined();
  });

  it("reacts to query data changes via setQueryData", async () => {
    const mockUser = {
      id: "u1",
      firstName: "John",
      lastName: "Doe",
      username: "johndoe",
      email: "john@test.com",
      isAdmin: false,
      isActive: true,
      image: null,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };

    mockGetAppInfo.mockResolvedValue({
      data: {
        appName: "Test",
        appDescription: "",
        appLogo: "",
        firstUserAccess: false,
      },
    } as ReturnType<typeof getAppInfo> extends Promise<infer R> ? R : never);

    mockGetCurrentUser.mockRejectedValue(new Error("Not logged in"));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(queryClient),
    });

    // Wait for unauthenticated state
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    // Simulate login flow setting query data directly
    act(() => {
      queryClient.setQueryData(queryKeys.auth.currentUser(), {
        user: mockUser,
      });
    });

    // Auth context should derive the new state
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.user?.id).toBe("u1");
    expect(result.current.isAdmin).toBe(false);
  });
});
