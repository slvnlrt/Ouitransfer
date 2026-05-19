"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { getLdapStatus, getLdapSyncLogs, triggerLdapSync } from "@/http/endpoints/ldap";
import type { LdapSyncLog } from "@/http/endpoints/ldap/types";
import { queryKeys } from "@/lib/query-keys";

const PAGE_SIZE = 10;

export function useLdapSync() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<LdapSyncLog | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

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

  const syncMutation = useMutation({
    mutationFn: () => triggerLdapSync(),
    onSuccess: () => {
      toast.success(t("ldap.sync.triggered"));
      queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : t("ldap.sync.error");
      toast.error(message);
    },
  });

  const handleViewDetail = (log: LdapSyncLog) => {
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDetailOpen(false);
    setSelectedLog(null);
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
