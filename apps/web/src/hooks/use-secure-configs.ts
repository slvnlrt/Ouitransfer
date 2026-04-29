"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import { getAllConfigs, getPublicConfigs } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";

interface Config {
  key: string;
  value: string;
  type: string;
  group: string;
  updatedAt: string;
}

/** Extract a human-readable error message from an unknown thrown value. */
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

/**
 * Hook to fetch public configurations (excludes sensitive SMTP data)
 * Safe to use without authentication
 */
export function useSecureConfigs() {
  const queryClient = useQueryClient();

  const {
    data: configs = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.config.public(),
    queryFn: async (): Promise<Config[]> => {
      const response = await getPublicConfigs();
      return response.data.configs;
    },
  });

  const error: string | null = queryError ? extractErrorMessage(queryError) : null;

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.config.public() });
  };

  return {
    configs,
    isLoading,
    error,
    reload,
  };
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

  const isUnauthorized =
    queryError != null &&
    axios.isAxiosError(queryError) &&
    (queryError.response?.status === 401 || queryError.response?.status === 403);

  const error: string | null = queryError
    ? isUnauthorized
      ? "Access denied: Administrator privileges required"
      : extractErrorMessage(queryError)
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

  const error: string | null = queryError ? extractErrorMessage(queryError) : null;

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
