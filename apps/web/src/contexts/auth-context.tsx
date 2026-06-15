"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAppInfoQuery } from "@/hooks/use-app-info-query";
import { getCurrentUser } from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

export type AuthUser = Omit<User, "isAdmin">;

/**
 * Tight timeout for the current-user request — it gates the full-screen
 * LoadingScreen, so it must fail fast instead of inheriting apiInstance's 120s
 * default (see use-app-info-query for the same rationale).
 */
const CURRENT_USER_TIMEOUT_MS = 15_000;

/**
 * Hard ceiling on how long auth may stay unresolved (`isAuthenticated === null`)
 * before we give up and treat the session as unauthenticated. The per-request
 * timeouts normally settle things in <15s; this is a last-resort backstop so a
 * request that never settles (a dead keep-alive socket after the tab was
 * backgrounded across a sleep / network change) can never wedge every
 * LoadingScreen gate on "Loading, please wait..." forever. Resolving to
 * unauthenticated routes the user to /login (a public page that always renders),
 * from where they recover once connectivity is back.
 */
const AUTH_RESOLUTION_CEILING_MS = 20_000;

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
      const response = await getCurrentUser({ timeout: CURRENT_USER_TIMEOUT_MS });
      return response.data;
    },
    enabled: appInfoQuery.isSuccess && !appInfoQuery.data?.firstUserAccess,
    retry: false, // Don't retry auth checks — if it fails, user is not authenticated
  });

  // Derive all auth state directly from query data — single source of truth
  const rawAuthState = useMemo((): Omit<AuthContextType, "logout"> => {
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
    currentUserQuery.data,
  ]);

  // Backstop against an unresolvable auth gate (see AUTH_RESOLUTION_CEILING_MS).
  // While auth is still resolving (`isAuthenticated === null`), arm a one-shot
  // timer; if it fires before the queries settle, force-resolve to
  // unauthenticated so the LoadingScreen can never hang indefinitely. The timer
  // is cleared/reset the moment auth resolves either way.
  const isResolving = rawAuthState.isAuthenticated === null;
  const [resolutionTimedOut, setResolutionTimedOut] = useState(false);

  useEffect(() => {
    if (!isResolving) {
      setResolutionTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setResolutionTimedOut(true), AUTH_RESOLUTION_CEILING_MS);
    return () => window.clearTimeout(timer);
  }, [isResolving]);

  const authState = useMemo<Omit<AuthContextType, "logout">>(
    () =>
      isResolving && resolutionTimedOut
        ? { user: null, isAuthenticated: false, isAdmin: false }
        : rawAuthState,
    [isResolving, resolutionTimedOut, rawAuthState],
  );

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
