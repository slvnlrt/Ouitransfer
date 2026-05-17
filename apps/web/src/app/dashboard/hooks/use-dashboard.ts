"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { FileItem } from "@/components/tables/files-table-types";
import { useEnhancedFileManager } from "@/hooks/use-enhanced-file-manager";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import { useShareManager } from "@/hooks/use-share-manager";
import { listFiles, listUserShares } from "@/http/endpoints";
import type { Share } from "@/http/endpoints/shares/types";
import { mapApiFiles } from "@/lib/api-mappers";
import { queryKeys } from "@/lib/query-keys";

export function useDashboard() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const { value: smtpEnabled } = useSecureConfigValue("smtpEnabled");

  // ── Modal state (pure UI, not server-derived) ──────────────────────
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const onOpenUploadModal = () => setIsUploadModalOpen(true);
  const onCloseUploadModal = () => setIsUploadModalOpen(false);
  const onOpenCreateModal = () => setIsCreateModalOpen(true);
  const onCloseCreateModal = () => setIsCreateModalOpen(false);

  // ── Files query ────────────────────────────────────────────────────
  const filesQuery = useQuery({
    queryKey: queryKeys.files.list(),
    queryFn: async () => {
      const res = await listFiles();
      return mapApiFiles(res.data.files || []);
    },
  });

  const recentFiles = useMemo<FileItem[]>(() => {
    const files = filesQuery.data;
    if (!files) return [];
    return [...files]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [filesQuery.data]);

  // ── Shares query ───────────────────────────────────────────────────
  const sharesQuery = useQuery({
    queryKey: queryKeys.shares.list(),
    queryFn: async () => {
      const res = await listUserShares();
      return (res.data.shares || []) as Share[];
    },
  });

  const recentShares = useMemo<Share[]>(() => {
    const shares = sharesQuery.data;
    if (!shares) return [];
    return [...shares]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [sharesQuery.data]);

  // ── Derived loading state ──────────────────────────────────────────
  const isLoading = filesQuery.isLoading || sharesQuery.isLoading;

  // ── Refresh via query invalidation ─────────────────────────────────
  const loadDashboardData = async () => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.files.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.shares.list() }),
      ]);
    } catch (_error) {
      toast.error(t("dashboard.loadError"));
    }
  };

  // ── Dependent hooks ────────────────────────────────────────────────
  const fileManager = useEnhancedFileManager(loadDashboardData);
  const shareManager = useShareManager(loadDashboardData);

  const handleCopyLink = (share: Share) => {
    if (!share.alias?.alias) return;
    const link = `${window.location.origin}/s/${share.alias.alias}`;

    navigator.clipboard.writeText(link);
    toast.success(t("dashboard.linkCopied"));
  };

  return {
    isLoading,
    recentFiles,
    recentShares,
    modals: {
      isUploadModalOpen,
      isCreateModalOpen,
      onOpenUploadModal,
      onCloseUploadModal,
      onOpenCreateModal,
      onCloseCreateModal,
    },
    fileManager,
    shareManager,
    handleCopyLink,
    loadDashboardData,
    smtpEnabled: smtpEnabled || "false",
  };
}
