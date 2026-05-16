import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import type { FileItem } from "@/components/tables/files-table-types";
import { deleteFile, updateFile } from "@/http/endpoints";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";

type FileToRename = Pick<FileItem, "id" | "name" | "description">;
type FileToDelete = Pick<FileItem, "id" | "name">;
type FileToShare = Pick<
  FileItem,
  "id" | "name" | "description" | "size" | "objectName" | "createdAt" | "updatedAt"
>;

interface PreviewFile {
  name: string;
  objectName: string;
  description?: string;
}

export interface FileCrudHook {
  previewFile: PreviewFile | null;
  fileToDelete: FileToDelete | null;
  fileToRename: FileToRename | null;
  fileToShare: FileToShare | null;

  setPreviewFile: (file: { name: string; objectName: string; description?: string } | null) => void;
  setFileToDelete: (file: { id: string; name: string } | null) => void;
  setFileToRename: (file: { id: string; name: string; description?: string } | null) => void;
  setFileToShare: (file: FileToShare | null) => void;

  handleDelete: (fileId: string) => Promise<void>;
  handleDownload: (objectName: string, fileName: string) => Promise<void>;
  handleRename: (fileId: string, newName: string, description?: string) => Promise<void>;
}

export function useFileCrud(
  handleImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null | "__DELETE__",
  ) => void,
): FileCrudHook {
  const t = useTranslations();

  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [fileToRename, setFileToRename] = useState<FileToRename | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileToDelete | null>(null);
  const [fileToShare, setFileToShare] = useState<FileToShare | null>(null);

  const handleDownload = async (objectName: string, fileName: string) => {
    try {
      const loadingToast = toast.loading(t("share.messages.downloadStarted"));
      const url = await getCachedDownloadUrl(objectName);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.dismiss(loadingToast);
      toast.success(t("shareManager.downloadSuccess"));
    } catch (error) {
      logger.error("[FileManager] Download failed", {
        fileName,
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("share.errors.downloadFailed"));
    }
  };

  const handleRename = async (fileId: string, newName: string, description?: string) => {
    try {
      await updateFile(fileId, {
        name: newName,
        description: description || null,
      });
      toast.success(t("files.updateSuccess"));
      setFileToRename(null);
    } catch (error) {
      logger.error("Failed to update file", {
        fileId,
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("files.updateError"));
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      // Optimistic update - remove from UI immediately
      if (handleImmediateUpdate) {
        handleImmediateUpdate(fileId, "file", "__DELETE__");
      }

      await deleteFile(fileId);
      toast.success(t("files.deleteSuccess"));
      setFileToDelete(null);
    } catch (error) {
      logger.error("Failed to delete file", {
        fileId,
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("files.deleteError"));
    }
  };

  return {
    previewFile,
    setPreviewFile,
    fileToRename,
    setFileToRename,
    fileToDelete,
    setFileToDelete,
    fileToShare,
    setFileToShare,
    handleDownload,
    handleRename,
    handleDelete,
  };
}
