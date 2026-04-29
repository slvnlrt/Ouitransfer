"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getAppInfo } from "@/http/endpoints";
import type { GetAppInfo200 } from "@/http/endpoints/app/types";
import { getQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const updateTitle = (name: string) => {
  if (typeof window !== "undefined" && name) {
    document.title = name;
  }
};

/**
 * TanStack Query–based hook that replaces the former Zustand store.
 *
 * Return shape is intentionally identical so all 13 consumers work unchanged.
 */
function useAppInfo() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.app.info(),
    queryFn: async () => {
      const response = await getAppInfo();
      return response.data;
    },
    staleTime: 60_000, // app info rarely changes
  });

  // Side effect: keep document.title in sync with appName
  useEffect(() => {
    if (data?.appName) {
      updateTitle(data.appName);
    }
  }, [data?.appName]);

  return {
    appName: data?.appName ?? "",
    appLogo: data?.appLogo ?? "",
    firstAccess: (data?.firstUserAccess as boolean | undefined) ?? null,
    isLoading,
    setAppName: (name: string) => {
      queryClient.setQueryData<GetAppInfo200>(queryKeys.app.info(), (old) =>
        old ? { ...old, appName: name } : undefined,
      );
      updateTitle(name);
    },
    setAppLogo: (logo: string) => {
      queryClient.setQueryData<GetAppInfo200>(queryKeys.app.info(), (old) =>
        old ? { ...old, appLogo: logo } : undefined,
      );
    },
    refreshAppInfo: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.app.info() });
    },
  };
}

/**
 * Standalone refresh for non-hook contexts.
 * Uses the browser singleton QueryClient directly.
 */
async function refreshAppInfoOutsideReact(): Promise<void> {
  const qc = getQueryClient();
  await qc.invalidateQueries({ queryKey: queryKeys.app.info() });
}

/**
 * Backward-compat shim: layout.tsx calls `useAppInfo.getState().refreshAppInfo()`.
 * That's a Zustand-specific API; we emulate just enough of it here so the import
 * keeps compiling. (The call site is inside `typeof window !== "undefined"` in a
 * Server Component, so it never actually executes at runtime.)
 */
useAppInfo.getState = () => ({
  refreshAppInfo: refreshAppInfoOutsideReact,
});

export { useAppInfo };
