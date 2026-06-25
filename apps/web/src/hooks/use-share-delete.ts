"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { deleteShare } from "@/http/endpoints";
import type { Share } from "@/http/endpoints/shares/types";

export interface ShareDeleteHook {
  shareToDelete: Share | null;
  sharesToDelete: Share[] | null;
  setShareToDelete: (share: Share | null) => void;
  setSharesToDelete: (shares: Share[] | null) => void;
  handleDelete: (shareId: string) => Promise<void>;
  handleBulkDelete: (shares: Share[]) => void;
  handleDeleteBulk: () => Promise<void>;
}

export function useShareDelete(
  onSuccess: () => void,
  clearSelectionCallback?: (() => void) | null,
): ShareDeleteHook {
  const t = useTranslations();
  const [shareToDelete, setShareToDelete] = useState<Share | null>(null);
  const [sharesToDelete, setSharesToDelete] = useState<Share[] | null>(null);

  const handleDelete = async (shareId: string) => {
    try {
      await deleteShare(shareId);
      toast.success(t("shareManager.deleteSuccess"));
      onSuccess();
      setShareToDelete(null);
    } catch {
      toast.error(t("shareManager.deleteError"));
    }
  };

  const handleBulkDelete = (shares: Share[]) => {
    setSharesToDelete(shares);
  };

  const handleDeleteBulk = async () => {
    if (!sharesToDelete) return;

    const loadingToast = toast.loading(
      t("shareManager.bulkDeleteLoading", { count: sharesToDelete.length }),
    );

    try {
      await Promise.all(sharesToDelete.map((share) => deleteShare(share.id)));
      toast.dismiss(loadingToast);
      toast.success(t("shareManager.bulkDeleteSuccess", { count: sharesToDelete.length }));
      setSharesToDelete(null);
      onSuccess();

      if (clearSelectionCallback) {
        clearSelectionCallback();
      }
    } catch {
      toast.dismiss(loadingToast);
      toast.error(t("shareManager.bulkDeleteError"));
    }
  };

  return {
    shareToDelete,
    sharesToDelete,
    setShareToDelete,
    setSharesToDelete,
    handleDelete,
    handleBulkDelete,
    handleDeleteBulk,
  };
}
