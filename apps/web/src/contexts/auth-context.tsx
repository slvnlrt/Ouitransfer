"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { getAppInfo, getCurrentUser } from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

type AuthUser = Omit<User, "isAdmin">;

type AuthContextType = {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  isAuthenticated: boolean | null;
  setIsAuthenticated: (value: boolean) => void;
  isAdmin: boolean | null;
  setIsAdmin: (value: boolean) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  isAuthenticated: null,
  setIsAuthenticated: () => {},
  isAdmin: null,
  setIsAdmin: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const queryClient = useQueryClient();

  const logout = () => {
    setUser(null);
    setIsAdmin(false);
    setIsAuthenticated(false);
    queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
  };

  // Shares cache with useAppInfo hook (both use queryKeys.app.info()) — no duplicate fetch
  const appInfoQuery = useQuery({
    queryKey: queryKeys.app.info(),
    queryFn: async () => {
      const response = await getAppInfo();
      return response.data;
    },
    staleTime: 60_000,
  });

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

  // Derive auth state from queries
  useEffect(() => {
    // Still loading app info
    if (appInfoQuery.isLoading) return;

    // First user access — no auth needed
    if (appInfoQuery.data?.firstUserAccess) {
      setUser(null);
      setIsAdmin(false);
      setIsAuthenticated(false);
      return;
    }

    // App info error — treat as unauthenticated
    if (appInfoQuery.isError) {
      setUser(null);
      setIsAdmin(false);
      setIsAuthenticated(false);
      return;
    }

    // Current user query still loading
    if (currentUserQuery.isLoading) return;

    // Current user success
    if (currentUserQuery.data?.user) {
      const { isAdmin: isAdminFlag, ...userData } = currentUserQuery.data.user;
      setUser(userData);
      setIsAdmin(isAdminFlag);
      setIsAuthenticated(true);
      return;
    }

    // Current user error or no data — unauthenticated
    setUser(null);
    setIsAdmin(false);
    setIsAuthenticated(false);
  }, [
    appInfoQuery.isLoading,
    appInfoQuery.isSuccess,
    appInfoQuery.isError,
    appInfoQuery.data,
    currentUserQuery.isLoading,
    currentUserQuery.data,
    currentUserQuery.isError,
  ]);

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated,
        setIsAuthenticated,
        isAdmin,
        setIsAdmin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
