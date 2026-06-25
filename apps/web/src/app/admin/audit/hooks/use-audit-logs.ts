"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getAuditLogs } from "@/http/endpoints/audit";
import type { AuditLogsParams } from "@/http/endpoints/audit/types";
import { queryKeys } from "@/lib/query-keys";

export function useAuditLogs() {
  const [params, setParams] = useState<AuditLogsParams>({
    limit: 50,
    offset: 0,
  });

  const queryParams: AuditLogsParams = {
    ...params,
    dateFrom: params.dateFrom ? `${params.dateFrom}T00:00:00.000Z` : undefined,
    dateTo: params.dateTo ? `${params.dateTo}T23:59:59.999Z` : undefined,
  };

  const query = useQuery({
    queryKey: queryKeys.admin.audit.logs(queryParams),
    queryFn: ({ signal }) => getAuditLogs(queryParams, { signal }),
    select: (response) => response.data,
  });

  const setPage = (page: number) => {
    setParams((prev) => ({
      ...prev,
      offset: page * (prev.limit ?? 50),
    }));
  };

  const setFilters = (filters: Partial<AuditLogsParams>) => {
    setParams((prev) => ({
      ...prev,
      ...filters,
      offset: 0,
    }));
  };

  const clearFilters = () => {
    setParams({ limit: 50, offset: 0 });
  };

  const currentPage = Math.floor((params.offset ?? 0) / (params.limit ?? 50));
  const totalPages = query.data ? Math.ceil(query.data.total / (params.limit ?? 50)) : 0;

  return {
    logs: query.data?.logs ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    params,
    currentPage,
    totalPages,
    setPage,
    setFilters,
    clearFilters,
  };
}
