"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getLdapStatus, getLdapSyncLogs, triggerLdapSync } from "@/http/endpoints/ldap";
import type { LdapSyncLog } from "@/http/endpoints/ldap/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import { useSyncPolling } from "./use-sync-polling";

const PAGE_SIZE = 10;

export function useLdapSync() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<LdapSyncLog | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  // M-1: Store close timer to avoid race condition when rapidly opening/closing details
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup close-detail timer on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const statusQuery = useQuery({
    queryKey: queryKeys.ldap.status(),
    queryFn: async () => {
      const res = await getLdapStatus();
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const logsQuery = useQuery({
    queryKey: [...queryKeys.ldap.syncLogs(), page],
    queryFn: async () => {
      const res = await getLdapSyncLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      return res.data;
    },
  });

  const handleSyncComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });
  }, [queryClient]);

  const handlePoll = useCallback(async () => {
    const res = await getLdapStatus();
    return !res.data.syncInProgress;
  }, []);

  const { startPolling } = useSyncPolling({
    onPoll: handlePoll,
    onComplete: handleSyncComplete,
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerLdapSync(),
    onSuccess: () => {
      toast.success(t("ldap.sync.triggered"));
      queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });

      // I-4: Poll for sync completion, then refresh user list
      startPolling();
    },
    onError: (error: unknown) => {
      // I-1: Extract structured error from API response
      const apiError = parseApiError(error);
      toast.error(apiError.message || t("ldap.sync.error"));
    },
  });

  const handleViewDetail = (log: LdapSyncLog) => {
    // M-1: Cancel any pending close timer before opening a new detail
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  // M-7: Delay clearing selectedLog to allow exit animation
  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    closeTimerRef.current = setTimeout(() => setSelectedLog(null), 200);
  };

  return {
    status: statusQuery.data ?? null,
    isLoadingStatus: statusQuery.isLoading,
    logs: logsQuery.data?.logs ?? [],
    totalLogs: logsQuery.data?.total ?? 0,
    isLoadingLogs: logsQuery.isLoading,
    isSyncing: syncMutation.isPending,
    onSync: () => syncMutation.mutate(),
    selectedLog,
    isDetailOpen,
    onViewDetail: handleViewDetail,
    onCloseDetail: handleCloseDetail,
    page,
    onPageChange: setPage,
  };
}
