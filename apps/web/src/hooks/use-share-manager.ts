"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { createShareAlias, updateShare } from "@/http/endpoints";
import { updateFolder } from "@/http/endpoints/folders";
import type { Share, UpdateShareBody } from "@/http/endpoints/shares/types";
import { useShareDelete } from "./use-share-delete";
import { useShareDownload } from "./use-share-download";
import { useShareRecipients } from "./use-share-recipients";

export interface ShareManagerHook {
  shareToDelete: Share | null;
  shareToEdit: Share | null;
  shareToManageFiles: Share | null;
  shareToManageRecipients: Share | null;
  shareToManageSecurity: Share | null;
  shareToManageExpiration: Share | null;
  shareToViewDetails: Share | null;
  shareToGenerateLink: Share | null;
  shareToViewQrCode: Share | null;
  sharesToDelete: Share[] | null;
  setShareToDelete: (share: Share | null) => void;
  setShareToEdit: (share: Share | null) => void;
  setShareToManageFiles: (share: Share | null) => void;
  setShareToManageRecipients: (share: Share | null) => void;
  setShareToManageSecurity: (share: Share | null) => void;
  setShareToManageExpiration: (share: Share | null) => void;
  setShareToViewDetails: (share: Share | null) => void;
  setShareToGenerateLink: (share: Share | null) => void;
  setShareToViewQrCode: (share: Share | null) => void;
  setSharesToDelete: (shares: Share[] | null) => void;
  handleDelete: (shareId: string) => Promise<void>;
  handleBulkDelete: (shares: Share[]) => void;
  handleBulkDownload: (shares: Share[]) => void;
  handleDownloadShareFiles: (share: Share) => Promise<void>;
  handleBulkDownloadWithZip: (shares: Share[], zipName: string) => Promise<void>;
  handleDeleteBulk: () => Promise<void>;
  handleEdit: (shareId: string, data: Omit<UpdateShareBody, "id">) => Promise<void>;
  handleUpdateName: (shareId: string, newName: string) => Promise<void>;
  handleUpdateDescription: (shareId: string, newDescription: string) => Promise<void>;
  handleUpdateSecurity: (share: Share) => Promise<void>;
  handleUpdateExpiration: (share: Share) => Promise<void>;
  handleManageFiles: () => Promise<void>;
  handleManageRecipients: (shareId: string, recipients: string[]) => Promise<void>;
  handleGenerateLink: (shareId: string, alias: string) => Promise<void>;
  handleNotifyRecipients: (share: Share) => Promise<void>;
  setClearSelectionCallback?: (callback: () => void) => void;
  handleEditFolder: (folderId: string, newName: string, description?: string) => Promise<void>;
}

export function useShareManager(onSuccess: () => void) {
  const t = useTranslations();

  // --- Selection callback management ---
  const [clearSelectionCallback, setClearSelectionCallbackState] = useState<(() => void) | null>(
    null,
  );
  const setClearSelectionCallback = useCallback((callback: () => void) => {
    setClearSelectionCallbackState(() => callback);
  }, []);

  // --- Compose sub-hooks ---
  const deletion = useShareDelete(onSuccess, clearSelectionCallback);
  const download = useShareDownload(clearSelectionCallback);
  const recipients = useShareRecipients(onSuccess);

  // --- Edit/modal state (remaining responsibilities in orchestrator) ---
  const [shareToEdit, setShareToEdit] = useState<Share | null>(null);
  const [shareToManageFiles, setShareToManageFiles] = useState<Share | null>(null);
  const [shareToManageSecurity, setShareToManageSecurity] = useState<Share | null>(null);
  const [shareToManageExpiration, setShareToManageExpiration] = useState<Share | null>(null);
  const [shareToViewDetails, setShareToViewDetails] = useState<Share | null>(null);
  const [shareToGenerateLink, setShareToGenerateLink] = useState<Share | null>(null);
  const [shareToViewQrCode, setShareToViewQrCode] = useState<Share | null>(null);

  const handleEdit = async (shareId: string, data: Omit<UpdateShareBody, "id">) => {
    try {
      await updateShare({ id: shareId, ...data });
      toast.success(t("shareManager.updateSuccess"));
      onSuccess();
      setShareToEdit(null);
    } catch {
      toast.error(t("shareManager.updateError"));
    }
  };

  const handleUpdateName = async (shareId: string, newName: string) => {
    try {
      await updateShare({ id: shareId, name: newName });
      await onSuccess();
      toast.success(t("shareManager.updateSuccess"));
    } catch {
      toast.error(t("shareManager.updateError"));
    }
  };

  const handleUpdateDescription = async (shareId: string, newDescription: string) => {
    try {
      await updateShare({ id: shareId, description: newDescription });
      await onSuccess();
      toast.success(t("shareManager.updateSuccess"));
    } catch {
      toast.error(t("shareManager.updateError"));
    }
  };

  const handleUpdateSecurity = async (share: Share) => {
    setShareToManageSecurity(share);
  };

  const handleUpdateExpiration = async (share: Share) => {
    setShareToManageExpiration(share);
  };

  const handleManageFiles = async () => {
    try {
      toast.success(t("shareManager.filesUpdateSuccess"));
      onSuccess();
      setShareToManageFiles(null);
    } catch {
      toast.error(t("shareManager.filesUpdateError"));
    }
  };

  const handleGenerateLink = async (shareId: string, alias: string) => {
    try {
      await createShareAlias(shareId, { alias });
      toast.success(t("shareManager.linkGenerateSuccess"));
      onSuccess();
    } catch (error) {
      toast.error(t("shareManager.linkGenerateError"));
      throw error;
    }
  };

  const handleEditFolder = async (folderId: string, newName: string, description?: string) => {
    try {
      await updateFolder(folderId, { name: newName, description });
      toast.success(t("shareManager.updateSuccess"));
      onSuccess();
    } catch {
      toast.error(t("shareManager.updateError"));
    }
  };

  // --- Return unified interface (consumers don't change) ---
  return {
    // Delete operations (from sub-hook)
    shareToDelete: deletion.shareToDelete,
    sharesToDelete: deletion.sharesToDelete,
    setShareToDelete: deletion.setShareToDelete,
    setSharesToDelete: deletion.setSharesToDelete,
    handleDelete: deletion.handleDelete,
    handleBulkDelete: deletion.handleBulkDelete,
    handleDeleteBulk: deletion.handleDeleteBulk,

    // Download operations (from sub-hook)
    handleBulkDownload: download.handleBulkDownload,
    handleDownloadShareFiles: download.handleDownloadShareFiles,
    handleBulkDownloadWithZip: download.handleBulkDownloadWithZip,

    // Recipient operations (from sub-hook)
    shareToManageRecipients: recipients.shareToManageRecipients,
    setShareToManageRecipients: recipients.setShareToManageRecipients,
    handleManageRecipients: recipients.handleManageRecipients,
    handleNotifyRecipients: recipients.handleNotifyRecipients,

    // Edit/modal state (orchestrator-local)
    shareToEdit,
    shareToManageFiles,
    shareToManageSecurity,
    shareToManageExpiration,
    shareToViewDetails,
    shareToGenerateLink,
    shareToViewQrCode,
    setShareToEdit,
    setShareToManageFiles,
    setShareToManageSecurity,
    setShareToManageExpiration,
    setShareToViewDetails,
    setShareToGenerateLink,
    setShareToViewQrCode,
    handleEdit,
    handleUpdateName,
    handleUpdateDescription,
    handleUpdateSecurity,
    handleUpdateExpiration,
    handleManageFiles,
    handleGenerateLink,
    setClearSelectionCallback,
    handleEditFolder,
  };
}
