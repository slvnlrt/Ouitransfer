"use client";

import { useQuery } from "@tanstack/react-query";

import { getAppInfo } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";

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
      const response = await getAppInfo();
      return response.data;
    },
    staleTime: 60_000, // app info rarely changes
  });
}
