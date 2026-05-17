"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/auth-context";
import { checkHealth, getDiskSpace } from "@/http/endpoints";
import { getAdminStats } from "@/http/endpoints/admin";
import type { AdminStats200 } from "@/http/endpoints/admin/types";
import { getHealthStatus } from "@/http/endpoints/app";
import type { CheckHealth200, DiskSpaceInfo, HealthStatus200 } from "@/http/endpoints/app/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";

export interface UseSystemStatusResult {
  // User view
  healthStatus: HealthStatus200 | null;
  healthStatusLoading: boolean;
  healthStatusError: string | null;

  // Admin view
  healthData: CheckHealth200 | null;
  healthLoading: boolean;
  healthError: boolean;

  diskSpace: DiskSpaceInfo | null;
  diskSpaceLoading: boolean;
  diskSpaceError: string | null;

  adminStats: AdminStats200 | null;
  adminStatsLoading: boolean;

  // Common
  isAdmin: boolean;
  refresh: () => void;
}

export function useSystemStatus(): UseSystemStatusResult {
  const { isAdmin } = useAuth();

  // Simplified health status (regular users only)
  const healthStatusQuery = useQuery({
    queryKey: queryKeys.app.healthStatus(),
    queryFn: async () => {
      const res = await getHealthStatus();
      return res.data;
    },
    refetchInterval: 60_000,
    enabled: !isAdmin,
  });

  // Detailed health (admin only)
  const healthQuery = useQuery({
    queryKey: queryKeys.app.health(),
    queryFn: async () => {
      const res = await checkHealth();
      return res.data;
    },
    refetchInterval: 60_000,
    enabled: !!isAdmin,
  });

  // Disk space (admin only)
  const diskSpaceQuery = useQuery({
    queryKey: queryKeys.app.diskSpace(),
    queryFn: async () => {
      const res = await getDiskSpace();
      return res.data;
    },
    enabled: !!isAdmin,
  });

  // Admin stats (admin only)
  const adminStatsQuery = useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: async () => {
      const res = await getAdminStats();
      return res.data;
    },
    enabled: !!isAdmin,
  });

  // Error parsing
  let diskSpaceError: string | null = null;
  if (diskSpaceQuery.isError) {
    const apiError = parseApiError(diskSpaceQuery.error);
    diskSpaceError = apiError.isNetworkError ? "network_error" : "server_error";
  }

  let healthStatusError: string | null = null;
  if (healthStatusQuery.isError) {
    const apiError = parseApiError(healthStatusQuery.error);
    healthStatusError = apiError.isNetworkError ? "network_error" : "fetch_error";
  }

  const refresh = () => {
    if (isAdmin) {
      healthQuery.refetch();
      diskSpaceQuery.refetch();
      adminStatsQuery.refetch();
    } else {
      healthStatusQuery.refetch();
    }
  };

  return {
    healthStatus: healthStatusQuery.data ?? null,
    healthStatusLoading: healthStatusQuery.isLoading,
    healthStatusError,
    healthData: healthQuery.data ?? null,
    healthLoading: healthQuery.isLoading,
    healthError: healthQuery.isError,
    diskSpace: diskSpaceQuery.data ?? null,
    diskSpaceLoading: diskSpaceQuery.isLoading,
    diskSpaceError,
    adminStats: adminStatsQuery.data ?? null,
    adminStatsLoading: adminStatsQuery.isLoading,
    isAdmin: !!isAdmin,
    refresh,
  };
}
