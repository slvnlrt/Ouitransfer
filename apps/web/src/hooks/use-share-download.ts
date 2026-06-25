"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { Share } from "@/http/endpoints/shares/types";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";

export interface ShareDownloadHook {
  handleDownloadShareFiles: (share: Share) => Promise<void>;
  handleBulkDownload: (shares: Share[]) => void;
  handleBulkDownloadWithZip: (shares: Share[], zipName: string) => Promise<void>;
}

export function useShareDownload(clearSelectionCallback?: (() => void) | null): ShareDownloadHook {
  const t = useTranslations();

  const handleBulkDownloadWithZip = async (shares: Share[], zipName: string) => {
    try {
      if (shares.length === 1) {
        const share = shares[0];

        const allItems: Array<{
          objectName?: string;
          name: string;
          id?: string;
          type?: "file" | "folder";
        }> = [];

        if (share.files) {
          share.files.forEach((file) => {
            if (!file.folderId) {
              allItems.push({
                objectName: file.objectName,
                name: file.name,
                type: "file",
              });
            }
          });
        }

        if (share.folders) {
          const folderIds = new Set(share.folders.map((f) => f.id));
          share.folders.forEach((folder) => {
            if (!folder.parentId || !folderIds.has(folder.parentId)) {
              allItems.push({
                id: folder.id,
                name: folder.name,
                type: "folder",
              });
            }
          });
        }

        if (allItems.length === 0) {
          toast.error(t("shareManager.noFilesToDownload"));
          return;
        }

        const loadingToast = toast.loading(t("shareManager.preparingDownload"));

        try {
          // Get presigned URLs for all files
          const downloadItems = await Promise.all(
            allItems
              .filter((item) => item.type === "file" && item.objectName)
              .map(async (item) => {
                const url = await getCachedDownloadUrl(item.objectName!);
                return {
                  url,
                  name: item.name,
                };
              }),
          );

          if (downloadItems.length === 0) {
            toast.dismiss(loadingToast);
            toast.error(t("shareManager.noFilesToDownload"));
            return;
          }

          // Create ZIP with all files
          const { downloadFilesAsZip } = await import("@/utils/zip-download");
          await downloadFilesAsZip(
            downloadItems,
            zipName.endsWith(".zip") ? zipName : `${zipName}.zip`,
          );

          toast.dismiss(loadingToast);
          toast.success(t("shareManager.zipDownloadSuccess"));

          if (clearSelectionCallback) {
            clearSelectionCallback();
          }
        } catch (error) {
          toast.dismiss(loadingToast);
          toast.error(t("shareManager.zipDownloadError"));
          throw error;
        }
      } else {
        toast.error(t("shareManager.errors.multipleDownloadNotSupported"));
      }
    } catch (error) {
      logger.error("Error creating ZIP", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleBulkDownload = (shares: Share[]) => {
    const zipName =
      shares.length === 1
        ? `${shares[0].name || t("shareManager.defaultShareName")}.zip`
        : t("shareManager.multipleSharesZipName", { count: shares.length });
    handleBulkDownloadWithZip(shares, zipName);
  };

  const handleDownloadShareFiles = async (share: Share) => {
    const totalFiles = share.files?.length || 0;
    const totalFolders = share.folders?.length || 0;

    if (totalFiles === 0 && totalFolders === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    if (totalFiles === 1 && totalFolders === 0) {
      const file = share.files[0];
      try {
        const loadingToast = toast.loading(t("shareManager.downloading"));
        const url = await getCachedDownloadUrl(file.objectName);

        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.downloadSuccess"));
      } catch (error) {
        logger.error("Download error", {
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("shareManager.downloadError"));
      }
    } else {
      const zipName = `${share.name || t("shareManager.defaultShareName")}.zip`;
      await handleBulkDownloadWithZip([share], zipName);
    }
  };

  return {
    handleDownloadShareFiles,
    handleBulkDownload,
    handleBulkDownloadWithZip,
  };
}
