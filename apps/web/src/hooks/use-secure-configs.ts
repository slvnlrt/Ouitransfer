"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getAllConfigs, getPublicConfigs } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";

interface Config {
  key: string;
  value: string;
  type: string;
  group: string;
  updatedAt: string;
}

/**
 * Hook to fetch configurations for administrators
 * REQUIRES ADMIN PERMISSIONS - returns error if user is not admin
 */
export function useAdminConfigs() {
  const queryClient = useQueryClient();

  const {
    data: configs = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.config.admin(),
    queryFn: async (): Promise<Config[]> => {
      const response = await getAllConfigs();
      return response.data.configs;
    },
  });

  const parsedQueryError = queryError ? parseApiError(queryError) : null;
  const isUnauthorized =
    parsedQueryError !== null &&
    (parsedQueryError.statusCode === 401 || parsedQueryError.statusCode === 403);

  const error: string | null = parsedQueryError
    ? isUnauthorized
      ? "Access denied: Administrator privileges required"
      : parsedQueryError.message
    : null;

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.config.admin() });
  };

  return {
    configs,
    isLoading,
    error,
    isUnauthorized,
    reload,
  };
}

/**
 * Hook to fetch a specific public configuration value
 * Only returns non-sensitive config values (excludes SMTP credentials)
 */
export function useSecureConfigValue(key: string) {
  const queryClient = useQueryClient();

  const {
    data: value = null,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.config.public(),
    queryFn: async (): Promise<Config[]> => {
      const response = await getPublicConfigs();
      return response.data.configs;
    },
    select: (configs: Config[]): string | null => configs.find((c) => c.key === key)?.value ?? null,
  });

  const error: string | null = queryError ? parseApiError(queryError).message : null;

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.config.public() });
  };

  return {
    value,
    isLoading,
    error,
    reload,
  };
}
