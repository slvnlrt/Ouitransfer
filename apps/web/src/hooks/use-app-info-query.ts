"use client";

import { useQuery } from "@tanstack/react-query";

import { getAppInfo } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";

/**
 * Tight timeout for the app-info request. This query gates the full-screen
 * LoadingScreen, so it must fail fast instead of inheriting apiInstance's 120s
 * default — on a dead keep-alive socket (tab backgrounded across a sleep /
 * network change) the default kept the loader up for minutes.
 */
const APP_INFO_TIMEOUT_MS = 15_000;

/**
 * Shared TanStack Query hook for app info data.
 *
 * Both `AuthProvider` and `useAppInfo` need the same query with identical
 * options. Defining staleTime in one place avoids inconsistent behavior
 * that depends on observer mount order.
 */
export function useAppInfoQuery() {
  return useQuery({
    queryKey: queryKeys.app.info(),
    queryFn: async () => {
      const response = await getAppInfo({ timeout: APP_INFO_TIMEOUT_MS });
      return response.data;
    },
    staleTime: 60_000, // app info rarely changes
  });
}
