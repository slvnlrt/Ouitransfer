"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAppInfoQuery } from "@/hooks/use-app-info-query";
import type { GetAppInfo200 } from "@/http/endpoints/app/types";
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
 * Uses the shared useAppInfoQuery() hook so staleTime is defined in one place (B-I9).
 */
function useAppInfo() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useAppInfoQuery();

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

export { useAppInfo };
