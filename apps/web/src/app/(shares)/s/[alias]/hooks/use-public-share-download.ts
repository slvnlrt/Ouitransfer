"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import type { Share } from "@/http/endpoints/shares/types";
import { mapShareFiles, mapShareFolders } from "@/lib/api-mappers";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";
import { getFolderFilesWithPath } from "@/utils/folder-traversal";

export interface PublicShareDownloadHook {
  handleDownload: (objectName: string, fileName: string) => Promise<void>;
  handleBulkDownload: () => Promise<void>;
  handleSelectedItemsBulkDownload: (files: FileItem[], folders: FolderItem[]) => Promise<void>;
}

export function usePublicShareDownload(
  share: Share | null,
  password: string,
): PublicShareDownloadHook {
  const t = useTranslations();

  const getDownloadOptions = () =>
    password ? { headers: { "x-share-password": password } } : undefined;

  const handleFolderDownload = async (folderId: string, folderName: string) => {
    if (!share) {
      throw new Error("Share data not available");
    }

    const shareFolderFiles = mapShareFiles(share.files || []);
    const shareFolderFolders = mapShareFolders(share.folders || []);

    // Use shared utility for recursive folder traversal
    const folderFilesWithPath = getFolderFilesWithPath(
      folderId,
      shareFolderFiles,
      shareFolderFolders,
    );

    if (folderFilesWithPath.length === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    const loadingToast = toast.loading(t("shareManager.creatingZip"));

    try {
      // Get presigned URLs for all files with their relative paths
      const downloadItems = await Promise.all(
        folderFilesWithPath.map(async ({ file, path }) => {
          const url = await getCachedDownloadUrl(file.objectName, getDownloadOptions());
          return {
            url,
            name: path ? `${path}/${file.name}` : file.name,
          };
        }),
      );

      // Create ZIP with all files
      const { downloadFilesAsZip } = await import("@/utils/zip-download");
      const zipName = `${folderName}.zip`;
      await downloadFilesAsZip(downloadItems, zipName);

      toast.dismiss(loadingToast);
      toast.success(t("shareManager.zipDownloadSuccess"));
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error(t("shareManager.zipDownloadError"));
      throw error;
    }
  };

  const handleDownload = async (objectName: string, fileName: string) => {
    try {
      if (objectName.startsWith("folder:")) {
        const folderId = objectName.replace("folder:", "");
        await handleFolderDownload(folderId, fileName);
        return;
      }

      const loadingToast = toast.loading(t("share.messages.downloadStarted"));

      const url = await getCachedDownloadUrl(objectName, getDownloadOptions());

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.dismiss(loadingToast);
      toast.success(t("shareManager.downloadSuccess"));
    } catch (error) {
      logger.error("Error downloading file", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("share.errors.downloadFailed"));
    }
  };

  const handleBulkDownload = async () => {
    const totalFiles = share?.files?.length || 0;
    const totalFolders = share?.folders?.length || 0;

    if (totalFiles === 0 && totalFolders === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    if (!share) {
      toast.error(t("share.errors.loadFailed"));
      return;
    }

    try {
      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        const bulkFiles = mapShareFiles(share.files || []);
        const bulkFolders = mapShareFolders(share.folders || []);

        const allFilesToDownload: Array<{ url: string; name: string }> = [];

        // Get presigned URLs for root level files (not in any folder)
        const rootFiles = bulkFiles.filter((f) => !f.folderId);
        const rootFileItems = await Promise.all(
          rootFiles.map(async (file) => {
            const url = await getCachedDownloadUrl(file.objectName, getDownloadOptions());
            return {
              url,
              name: file.name,
            };
          }),
        );
        allFilesToDownload.push(...rootFileItems);

        // Get presigned URLs for files in root level folders using shared utility
        const rootFolders = bulkFolders.filter((f) => !f.parentId);
        for (const folder of rootFolders) {
          const folderFiles = getFolderFilesWithPath(
            folder.id,
            bulkFiles,
            bulkFolders,
            folder.name,
          );

          const folderFileItems = await Promise.all(
            folderFiles.map(async ({ file, path }) => {
              const url = await getCachedDownloadUrl(file.objectName, getDownloadOptions());
              return {
                url,
                name: path ? `${path}/${file.name}` : file.name,
              };
            }),
          );
          allFilesToDownload.push(...folderFileItems);
        }

        if (allFilesToDownload.length === 0) {
          toast.dismiss(loadingToast);
          toast.error(t("shareManager.noFilesToDownload"));
          return;
        }

        // Create ZIP with all files
        const { downloadFilesAsZip } = await import("@/utils/zip-download");
        const zipName = `${share.name || t("shareManager.defaultShareName")}.zip`;
        await downloadFilesAsZip(allFilesToDownload, zipName);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error creating ZIP", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSelectedItemsBulkDownload = async (files: FileItem[], folders: FolderItem[]) => {
    if (files.length === 0 && folders.length === 0) {
      toast.error(t("shareManager.noFilesToDownload"));
      return;
    }

    if (!share) {
      toast.error(t("share.errors.loadFailed"));
      return;
    }

    try {
      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        const selBulkFiles = mapShareFiles(share.files || []);
        const selBulkFolders = mapShareFolders(share.folders || []);

        const allFilesToDownload: Array<{ url: string; name: string }> = [];

        // Get presigned URLs for direct files (not in folders)
        const directFileItems = await Promise.all(
          files.map(async (file) => {
            const url = await getCachedDownloadUrl(file.objectName, getDownloadOptions());
            return {
              url,
              name: file.name,
            };
          }),
        );
        allFilesToDownload.push(...directFileItems);

        // Get presigned URLs for files in selected folders using shared utility
        for (const folder of folders) {
          const folderFiles = getFolderFilesWithPath(
            folder.id,
            selBulkFiles,
            selBulkFolders,
            folder.name,
          );

          const folderFileItems = await Promise.all(
            folderFiles.map(async ({ file, path }) => {
              const url = await getCachedDownloadUrl(file.objectName, getDownloadOptions());
              return {
                url,
                name: path ? `${path}/${file.name}` : file.name,
              };
            }),
          );
          allFilesToDownload.push(...folderFileItems);
        }

        if (allFilesToDownload.length === 0) {
          toast.dismiss(loadingToast);
          toast.error(t("shareManager.noFilesToDownload"));
          return;
        }

        // Create ZIP with all files
        const { downloadFilesAsZip } = await import("@/utils/zip-download");
        const finalZipName = `${share.name || t("shareManager.defaultShareName")}-selected.zip`;
        await downloadFilesAsZip(allFilesToDownload, finalZipName);

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error creating ZIP", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("shareManager.zipDownloadError"));
    }
  };

  return {
    handleDownload,
    handleBulkDownload,
    handleSelectedItemsBulkDownload,
  };
}
