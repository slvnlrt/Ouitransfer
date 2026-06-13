"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/auth-context";
import { checkHealth, getDiskSpace } from "@/http/endpoints";
import { getAdminStats } from "@/http/endpoints/admin";
import type { AdminStats200 } from "@/http/endpoints/admin/types";
import { getHealthStatus } from "@/http/endpoints/app";
import type { CheckHealth200, DiskSpaceInfo, HealthStatus200 } from "@/http/endpoints/app/types";
import { getEmailStats } from "@/http/endpoints/notifications";
import type { EmailStats } from "@/http/endpoints/notifications/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";

type DashboardError = "network_error" | "server_error" | "fetch_error" | null;

export interface UseSystemStatusResult {
  // User view
  healthStatus: HealthStatus200 | null;
  healthStatusLoading: boolean;
  healthStatusError: DashboardError;

  // Admin view
  healthData: CheckHealth200 | null;
  healthLoading: boolean;
  healthError: boolean;

  diskSpace: DiskSpaceInfo | null;
  diskSpaceLoading: boolean;
  diskSpaceError: DashboardError;

  adminStats: AdminStats200 | null;
  adminStatsLoading: boolean;
  adminStatsError: DashboardError;

  emailStats: EmailStats | null;
  emailStatsLoading: boolean;
  emailStatsError: DashboardError;

  // Common
  isAdmin: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

export function useSystemStatus(options?: { isExpanded?: boolean }): UseSystemStatusResult {
  const { isExpanded = false } = options ?? {};
  const { isAdmin, user } = useAuth();

  const POLL_ACTIVE = 60_000; // 60s when expanded
  const POLL_BACKGROUND = 300_000; // 5 min when collapsed
  const pollInterval = isExpanded ? POLL_ACTIVE : POLL_BACKGROUND;

  // Simplified health status (regular users only)
  const healthStatusQuery = useQuery({
    queryKey: queryKeys.app.healthStatus(),
    queryFn: async () => {
      const res = await getHealthStatus();
      return res.data;
    },
    refetchInterval: pollInterval,
    enabled: !isAdmin,
  });

  // Detailed health (admin only)
  const healthQuery = useQuery({
    queryKey: queryKeys.app.health(),
    queryFn: async () => {
      const res = await checkHealth();
      return res.data;
    },
    refetchInterval: pollInterval,
    enabled: !!isAdmin,
  });

  // Disk space (all users — non-admins get quota data from the same endpoint)
  const diskSpaceQuery = useQuery({
    queryKey: queryKeys.app.diskSpace(),
    queryFn: async () => {
      const res = await getDiskSpace();
      return res.data;
    },
    refetchInterval: pollInterval,
    enabled: !!user,
  });

  // Admin stats (admin only — only useful in expanded admin view)
  const adminStatsQuery = useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: async () => {
      const res = await getAdminStats();
      return res.data;
    },
    refetchInterval: POLL_ACTIVE,
    enabled: !!isAdmin && isExpanded,
  });

  // Email / notifications stats (admin only — only useful in expanded admin view)
  const emailStatsQuery = useQuery({
    queryKey: queryKeys.admin.emailStats(),
    queryFn: async () => {
      const res = await getEmailStats();
      return res.data;
    },
    refetchInterval: POLL_ACTIVE,
    enabled: !!isAdmin && isExpanded,
  });

  // Error parsing
  let diskSpaceError: DashboardError = null;
  if (diskSpaceQuery.isError) {
    const apiError = parseApiError(diskSpaceQuery.error);
    diskSpaceError = apiError.isNetworkError ? "network_error" : "server_error";
  }

  let healthStatusError: DashboardError = null;
  if (healthStatusQuery.isError) {
    const apiError = parseApiError(healthStatusQuery.error);
    healthStatusError = apiError.isNetworkError ? "network_error" : "fetch_error";
  }

  let adminStatsError: DashboardError = null;
  if (adminStatsQuery.isError) {
    const apiError = parseApiError(adminStatsQuery.error);
    adminStatsError = apiError.isNetworkError ? "network_error" : "server_error";
  }

  let emailStatsError: DashboardError = null;
  if (emailStatsQuery.isError) {
    const apiError = parseApiError(emailStatsQuery.error);
    emailStatsError = apiError.isNetworkError ? "network_error" : "server_error";
  }

  const refresh = () => {
    diskSpaceQuery.refetch();
    if (isAdmin) {
      healthQuery.refetch();
      adminStatsQuery.refetch();
      emailStatsQuery.refetch();
    } else {
      healthStatusQuery.refetch();
    }
  };

  const isRefreshing = isAdmin
    ? healthQuery.isFetching ||
      diskSpaceQuery.isFetching ||
      adminStatsQuery.isFetching ||
      emailStatsQuery.isFetching
    : healthStatusQuery.isFetching || diskSpaceQuery.isFetching;

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
    adminStatsError,
    emailStats: emailStatsQuery.data ?? null,
    emailStatsLoading: emailStatsQuery.isLoading,
    emailStatsError,
    isAdmin: !!isAdmin,
    isRefreshing,
    refresh,
  };
}
