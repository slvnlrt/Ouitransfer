"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { createContext, useContext, useMemo } from "react";
import { useAppInfoQuery } from "@/hooks/use-app-info-query";
import { getCurrentUser } from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

/**
 * Whether a current-user probe error means the session is genuinely over
 * (401/403) versus a transient connectivity failure (no response). Only the
 * former should drop authenticated state; a network/timeout error must keep the
 * cached state so a brief offline blip doesn't bounce the user to /login.
 */
function isAuthFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 401 || status === 403;
}

export type AuthUser = Omit<User, "isAdmin">;

type AuthContextType = {
  user: AuthUser | null;
  isAuthenticated: boolean | null;
  isAdmin: boolean | null;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: null,
  isAdmin: null,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Shares cache with useAppInfo hook — no duplicate fetch (B-I9: staleTime in shared hook)
  const appInfoQuery = useAppInfoQuery();

  // Fetch current user only when app info is loaded and it's not first-user setup
  const currentUserQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: async () => {
      const response = await getCurrentUser();
      return response.data;
    },
    enabled: appInfoQuery.isSuccess && !appInfoQuery.data?.firstUserAccess,
    retry: false, // Don't retry auth checks — if it fails, user is not authenticated
  });

  // Derive all auth state directly from query data — single source of truth
  const authState = useMemo((): Omit<AuthContextType, "logout"> => {
    // Still loading app info
    if (appInfoQuery.isLoading) {
      return { user: null, isAuthenticated: null, isAdmin: null };
    }

    // First user access — no auth needed
    if (appInfoQuery.data?.firstUserAccess) {
      return { user: null, isAuthenticated: false, isAdmin: false };
    }

    // App info error — treat as unauthenticated
    if (appInfoQuery.isError) {
      return { user: null, isAuthenticated: false, isAdmin: false };
    }

    // Current user query still loading
    if (currentUserQuery.isLoading) {
      return { user: null, isAuthenticated: null, isAdmin: null };
    }

    // A 401/403 on the current-user probe means the session is genuinely gone.
    // This MUST be checked before the `data?.user` branch below: React Query
    // RETAINS the previous `data` across a failed refetch, so a stale user would
    // otherwise keep `isAuthenticated === true` after the session expired (e.g. on
    // tab return) — the infinite "/login" spinner that only a hard reload (which
    // clears the cache) recovered from. Network/timeout errors are deliberately
    // NOT treated as logout (offline ≠ logged out), matching the api.ts refresh
    // interceptor, so we fall through and keep the cached state for those.
    if (currentUserQuery.isError && isAuthFailure(currentUserQuery.error)) {
      return { user: null, isAuthenticated: false, isAdmin: false };
    }

    // Current user success
    if (currentUserQuery.data?.user) {
      const { isAdmin: isAdminFlag, ...userData } = currentUserQuery.data.user;
      return { user: userData, isAuthenticated: true, isAdmin: isAdminFlag };
    }

    // Current user error or no data — unauthenticated
    return { user: null, isAuthenticated: false, isAdmin: false };
  }, [
    appInfoQuery.isLoading,
    appInfoQuery.isError,
    appInfoQuery.data,
    currentUserQuery.isLoading,
    currentUserQuery.isError,
    currentUserQuery.error,
    currentUserQuery.data,
  ]);

  const logout = () => {
    queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
    // Clear app.info so it re-fetches after redirect — prevents stale firstUserAccess
    // if the last user was deleted while logged in (B-I1 reviewer finding)
    queryClient.removeQueries({ queryKey: queryKeys.app.info() });
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
