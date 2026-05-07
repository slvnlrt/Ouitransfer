"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { useAppInfoQuery } from "@/hooks/use-app-info-query";
import { getCurrentUser } from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

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
