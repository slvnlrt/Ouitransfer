import axios from "axios";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import type { FileItem } from "@/components/tables/files-table-types";
import { deleteFile, updateFile } from "@/http/endpoints";
import type { DeleteFile409 } from "@/http/endpoints/files";
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
  fileInSharesWarning: { id: string; name: string; shareCount: number } | null;

  setPreviewFile: (file: { name: string; objectName: string; description?: string } | null) => void;
  setFileToDelete: (file: { id: string; name: string } | null) => void;
  setFileToRename: (file: { id: string; name: string; description?: string } | null) => void;
  setFileToShare: (file: FileToShare | null) => void;
  setFileInSharesWarning: (
    warning: { id: string; name: string; shareCount: number } | null,
  ) => void;

  handleDelete: (fileId: string) => Promise<void>;
  handleForceDelete: (fileId: string) => Promise<void>;
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
  const [fileInSharesWarning, setFileInSharesWarning] = useState<{
    id: string;
    name: string;
    shareCount: number;
  } | null>(null);

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
      await deleteFile(fileId);

      // Remove from UI only after server confirms deletion
      if (handleImmediateUpdate) {
        handleImmediateUpdate(fileId, "file", "__DELETE__");
      }

      toast.success(t("files.deleteSuccess"));
      setFileToDelete(null);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const data = error.response.data as DeleteFile409;
        setFileInSharesWarning({
          id: fileId,
          name: fileToDelete?.name ?? "",
          shareCount: data.shareCount,
        });
        setFileToDelete(null);
      } else {
        logger.error("Failed to delete file", {
          fileId,
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("files.deleteError"));
      }
    }
  };

  const handleForceDelete = async (fileId: string) => {
    try {
      await deleteFile(fileId, true);

      // Remove from UI after server confirms force-deletion
      if (handleImmediateUpdate) {
        handleImmediateUpdate(fileId, "file", "__DELETE__");
      }

      toast.success(t("files.deleteSuccess"));
      setFileToDelete(null);
      setFileInSharesWarning(null);
    } catch (error) {
      logger.error("Failed to force-delete file", {
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
    fileInSharesWarning,
    setFileInSharesWarning,
    handleDownload,
    handleRename,
    handleDelete,
    handleForceDelete,
  };
}
