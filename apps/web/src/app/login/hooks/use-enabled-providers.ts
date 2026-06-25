"use client";

import { useQuery } from "@tanstack/react-query";
import { getEnabledProviders } from "@/http/endpoints";
import type { EnabledAuthProvider } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

export function useEnabledProviders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.auth.providers.enabled(),
    queryFn: async (): Promise<EnabledAuthProvider[]> => {
      const response = await getEnabledProviders();
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    enabled: options?.enabled ?? true,
  });
}
