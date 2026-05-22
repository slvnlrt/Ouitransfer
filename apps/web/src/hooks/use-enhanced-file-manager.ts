import axios from "axios";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { deleteFile } from "@/http/endpoints";
import { deleteFolder } from "@/http/endpoints/folders";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";
import { getFolderFilesWithPath } from "@/utils/folder-traversal";
import { useFileCrud } from "./use-file-crud";
import { useFolderCrud } from "./use-folder-crud";

type FileToRename = Pick<FileItem, "id" | "name" | "description">;
type FileToDelete = Pick<FileItem, "id" | "name">;

interface PreviewFile {
  name: string;
  objectName: string;
  description?: string;
}

type FileToShare = Pick<
  FileItem,
  "id" | "name" | "description" | "size" | "objectName" | "createdAt" | "updatedAt"
>;
type FolderToRename = Pick<FolderItem, "id" | "name" | "description">;
type FolderToDelete = Pick<FolderItem, "id" | "name">;
type FolderToShare = Pick<
  FolderItem,
  "id" | "name" | "description" | "objectName" | "parentId" | "userId" | "createdAt" | "updatedAt"
>;
type BulkFile = Pick<
  FileItem,
  "id" | "name" | "description" | "size" | "objectName" | "folderId" | "createdAt" | "updatedAt"
> & { relativePath?: string };
export interface EnhancedFileManagerHook {
  previewFile: PreviewFile | null;
  fileToDelete: FileToDelete | null;
  fileToRename: FileToRename | null;
  fileToShare: FileToShare | null;
  fileInSharesWarning: { id: string; name: string; shareCount: number } | null;
  filesInSharesWarning: Array<{ id: string; name: string }> | null;
  folderInSharesWarning: { id: string; name: string; shareCount: number } | null;
  foldersInSharesWarning: Array<{ id: string; name: string }> | null;
  filesToDelete: BulkFile[] | null;
  filesToShare: BulkFile[] | null;
  filesToDownload: BulkFile[] | null;
  foldersToDelete: FolderItem[] | null;
  isBulkDownloadModalOpen: boolean;

  folderToDelete: FolderToDelete | null;
  folderToRename: FolderToRename | null;
  folderToShare: FolderToShare | null;
  isCreateFolderModalOpen: boolean;

  foldersToShare: FolderItem[] | null;
  foldersToDownload: FolderItem[] | null;

  // These setters accept any object with at least {id, name} to be callable from
  // components that have their own local File/Folder types
  setFileToDelete: (file: { id: string; name: string } | null) => void;
  setFileToRename: (file: { id: string; name: string; description?: string } | null) => void;
  setPreviewFile: (file: { name: string; objectName: string; description?: string } | null) => void;
  setFileToShare: (file: FileToShare | null) => void;
  setFileInSharesWarning: (
    warning: { id: string; name: string; shareCount: number } | null,
  ) => void;
  setFilesInSharesWarning: (files: Array<{ id: string; name: string }> | null) => void;
  setFolderInSharesWarning: (
    warning: { id: string; name: string; shareCount: number } | null,
  ) => void;
  setFoldersInSharesWarning: (folders: Array<{ id: string; name: string }> | null) => void;
  setFilesToDelete: (files: BulkFile[] | null) => void;
  setFilesToShare: (files: BulkFile[] | null) => void;
  setFilesToDownload: (files: BulkFile[] | null) => void;
  setFoldersToDelete: (folders: FolderItem[] | null) => void;
  setBulkDownloadModalOpen: (open: boolean) => void;

  setFolderToDelete: (folder: FolderToDelete | null) => void;
  setFolderToRename: (folder: FolderToRename | null) => void;
  setFolderToShare: (folder: FolderToShare | null) => void;
  setCreateFolderModalOpen: (open: boolean) => void;
  setFoldersToShare: (folders: FolderItem[] | null) => void;
  setFoldersToDownload: (folders: FolderItem[] | null) => void;

  handleDelete: (fileId: string) => Promise<void>;
  handleForceDelete: (fileId: string) => Promise<void>;
  handleForceBulkDelete: () => Promise<void>;
  handleDownload: (objectName: string, fileName: string) => Promise<void>;
  handleRename: (fileId: string, newName: string, description?: string) => Promise<void>;
  handleBulkDelete: (files: BulkFile[], folders?: FolderItem[]) => void;
  handleBulkShare: (files: BulkFile[], folders?: FolderItem[]) => void;
  handleBulkDownload: (files: BulkFile[], folders?: FolderItem[]) => void;
  handleBulkDownloadWithZip: (files: BulkFile[], zipName: string) => Promise<void>;
  handleDeleteBulk: () => Promise<void>;
  handleShareBulkSuccess: () => void;

  handleCreateFolder: (
    data: { name: string; description?: string },
    parentId?: string,
  ) => Promise<void>;
  handleFolderDelete: (folderId: string, folderName: string) => Promise<void>;
  handleFolderForceDelete: (folderId: string) => Promise<void>;
  handleFolderRename: (folderId: string, newName: string, description?: string) => Promise<void>;
  handleForceBulkFolderDelete: () => Promise<void>;

  clearSelection?: () => void;
  setClearSelectionCallback?: (callback: () => void) => void;
}

/** Minimal folder shape needed for recursive subfolder traversal in bulk download */
interface TraversalFolder {
  id: string;
  name: string;
  parentId?: string | null;
}

export function useEnhancedFileManager(
  onRefresh: () => Promise<void>,
  clearSelection?: () => void,
  handleImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null | "__DELETE__",
  ) => void,
  allFiles?: BulkFile[],
  allFolders?: TraversalFolder[],
) {
  const t = useTranslations();

  // --- Selection callback management ---
  const [clearSelectionCallback, setClearSelectionCallbackState] = useState<(() => void) | null>(
    null,
  );
  const setClearSelectionCallback = useCallback((callback: () => void) => {
    setClearSelectionCallbackState(() => callback);
  }, []);

  // --- Compose sub-hooks ---
  const fileCrud = useFileCrud(handleImmediateUpdate);
  const folderCrud = useFolderCrud(onRefresh, handleImmediateUpdate, clearSelectionCallback);

  // --- Bulk operation state (coordinates across file + folder concerns) ---
  const [filesToDelete, setFilesToDelete] = useState<BulkFile[] | null>(null);
  const [filesToShare, setFilesToShare] = useState<BulkFile[] | null>(null);
  const [filesToDownload, setFilesToDownload] = useState<BulkFile[] | null>(null);
  const [foldersToDelete, setFoldersToDelete] = useState<FolderItem[] | null>(null);
  const [foldersToShare, setFoldersToShare] = useState<FolderItem[] | null>(null);
  const [foldersToDownload, setFoldersToDownload] = useState<FolderItem[] | null>(null);
  const [isBulkDownloadModalOpen, setBulkDownloadModalOpen] = useState(false);
  const [filesInSharesWarning, setFilesInSharesWarning] = useState<Array<{
    id: string;
    name: string;
  }> | null>(null);
  const [foldersInSharesWarning, setFoldersInSharesWarning] = useState<Array<{
    id: string;
    name: string;
  }> | null>(null);

  // --- Bulk operation handlers ---
  const handleBulkDelete = (files: BulkFile[], folders?: FolderItem[]) => {
    setFilesToDelete(files.length > 0 ? files : null);
    setFoldersToDelete(folders && folders.length > 0 ? folders : null);
  };

  const handleBulkShare = (files: BulkFile[], folders?: FolderItem[]) => {
    setFilesToShare(files);
    setFoldersToShare(folders || null);
  };

  const handleShareBulkSuccess = () => {
    setFilesToShare(null);
    setFoldersToShare(null);
    if (clearSelectionCallback) {
      clearSelectionCallback();
    }
  };

  const handleBulkDownload = (files: BulkFile[], folders?: FolderItem[]) => {
    setFilesToDownload(files);
    setFoldersToDownload(folders || null);
    setBulkDownloadModalOpen(true);

    if (clearSelectionCallback) {
      clearSelectionCallback();
    }
  };

  const handleBulkDownloadWithZip = async (files: BulkFile[], zipName: string) => {
    try {
      const folders = foldersToDownload || [];

      if (files.length === 0 && folders.length === 0) {
        toast.error(t("shareManager.noFilesToDownload"));
        return;
      }

      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        // Collect all files including those in folders recursively
        const allFilesToDownload: Array<{ url: string; name: string }> = [];

        // Get presigned URLs for direct files (not in folders)
        const directFileItems = await Promise.all(
          files.map(async (file) => {
            const url = await getCachedDownloadUrl(file.objectName);
            return {
              url,
              name: file.name,
            };
          }),
        );
        allFilesToDownload.push(...directFileItems);

        // Get presigned URLs for files in selected folders using shared utility
        for (const folder of folders) {
          const folderFiles =
            allFiles && allFolders
              ? getFolderFilesWithPath(folder.id, allFiles, allFolders, folder.name)
              : [];

          const folderFileItems = await Promise.all(
            folderFiles.map(async ({ file, path }) => {
              const url = await getCachedDownloadUrl(file.objectName);
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
        await downloadFilesAsZip(
          allFilesToDownload,
          zipName.endsWith(".zip") ? zipName : `${zipName}.zip`,
        );

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }

      setBulkDownloadModalOpen(false);
      setFilesToDownload(null);
      setFoldersToDownload(null);
      if (clearSelectionCallback) {
        clearSelectionCallback();
      }
    } catch (error) {
      logger.error("Error in bulk download", {
        err: error instanceof Error ? error.message : String(error),
      });
      setBulkDownloadModalOpen(false);
      setFilesToDownload(null);
      setFoldersToDownload(null);
    }
  };

  const handleDeleteBulk = async () => {
    if (!filesToDelete && !foldersToDelete) return;

    try {
      // Delete folders — use allSettled to detect 409 (share check)
      let succeededFolderCount = 0;
      if (foldersToDelete) {
        const folderResults = await Promise.allSettled(
          foldersToDelete.map((folder) => deleteFolder(folder.id)),
        );

        const succeededFolders = foldersToDelete.filter(
          (_, i) => folderResults[i].status === "fulfilled",
        );
        const failedFoldersWith409 = foldersToDelete.filter((_, i) => {
          const result = folderResults[i];
          return (
            result.status === "rejected" &&
            axios.isAxiosError(result.reason) &&
            result.reason.response?.status === 409
          );
        });

        succeededFolderCount = succeededFolders.length;

        if (handleImmediateUpdate) {
          succeededFolders.forEach((folder) => {
            handleImmediateUpdate(folder.id, "folder", "__DELETE__");
          });
        }

        if (failedFoldersWith409.length > 0) {
          setFoldersInSharesWarning(failedFoldersWith409.map((f) => ({ id: f.id, name: f.name })));
        }
      }

      // Delete files — use allSettled to detect which succeed vs 409
      if (filesToDelete) {
        const results = await Promise.allSettled(filesToDelete.map((file) => deleteFile(file.id)));

        const succeeded = filesToDelete.filter((_, i) => results[i].status === "fulfilled");
        const failedWith409 = filesToDelete.filter((_, i) => {
          const result = results[i];
          return (
            result.status === "rejected" &&
            axios.isAxiosError(result.reason) &&
            result.reason.response?.status === 409
          );
        });

        // Optimistic update only for succeeded files
        if (handleImmediateUpdate) {
          succeeded.forEach((file) => {
            handleImmediateUpdate(file.id, "file", "__DELETE__");
          });
        }

        if (failedWith409.length > 0) {
          // Show bulk shares warning dialog
          setFilesInSharesWarning(failedWith409.map((file) => ({ id: file.id, name: file.name })));
        }

        const totalSucceeded = succeeded.length + succeededFolderCount;
        if (totalSucceeded > 0) {
          toast.success(t("files.bulkDeleteSuccess", { count: totalSucceeded }));
        }
      } else {
        // Only folders were deleted
        if (succeededFolderCount > 0) {
          toast.success(t("files.bulkDeleteSuccess", { count: succeededFolderCount }));
        }
      }

      setFilesToDelete(null);
      setFoldersToDelete(null);
    } catch (error) {
      logger.error("Failed to delete items", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("files.bulkDeleteError"));
    }
  };

  const handleForceBulkDelete = async () => {
    if (!filesInSharesWarning) return;

    try {
      const results = await Promise.allSettled(
        filesInSharesWarning.map((file) => deleteFile(file.id, true)),
      );

      const succeeded = filesInSharesWarning.filter((_, i) => results[i].status === "fulfilled");

      if (handleImmediateUpdate) {
        succeeded.forEach((file) => {
          handleImmediateUpdate(file.id, "file", "__DELETE__");
        });
      }

      if (succeeded.length > 0) {
        toast.success(t("files.bulkDeleteSuccess", { count: succeeded.length }));
      }

      const failed = filesInSharesWarning.length - succeeded.length;
      if (failed > 0) {
        toast.error(t("files.bulkDeleteError"));
      }

      setFilesInSharesWarning(null);
    } catch (error) {
      logger.error("Failed to force-delete files in shares", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("files.bulkDeleteError"));
    }
  };

  const handleForceBulkFolderDelete = async () => {
    if (!foldersInSharesWarning) return;

    try {
      const results = await Promise.allSettled(
        foldersInSharesWarning.map((folder) => deleteFolder(folder.id, true)),
      );

      const succeeded = foldersInSharesWarning.filter((_, i) => results[i].status === "fulfilled");

      if (handleImmediateUpdate) {
        succeeded.forEach((folder) => {
          handleImmediateUpdate(folder.id, "folder", "__DELETE__");
        });
      }

      if (succeeded.length > 0) {
        toast.success(t("files.bulkDeleteSuccess", { count: succeeded.length }));
      }

      const failed = foldersInSharesWarning.length - succeeded.length;
      if (failed > 0) {
        toast.error(t("files.bulkDeleteError"));
      }

      setFoldersInSharesWarning(null);
    } catch (error) {
      logger.error("Failed to force-delete folders in shares", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("files.bulkDeleteError"));
    }
  };

  // --- Return unified interface (consumers don't change) ---
  return {
    // File CRUD (from sub-hook)
    previewFile: fileCrud.previewFile,
    setPreviewFile: fileCrud.setPreviewFile,
    fileToRename: fileCrud.fileToRename,
    setFileToRename: fileCrud.setFileToRename,
    fileToDelete: fileCrud.fileToDelete,
    setFileToDelete: fileCrud.setFileToDelete,
    fileToShare: fileCrud.fileToShare,
    setFileToShare: fileCrud.setFileToShare,
    fileInSharesWarning: fileCrud.fileInSharesWarning,
    setFileInSharesWarning: fileCrud.setFileInSharesWarning,
    handleDownload: fileCrud.handleDownload,
    handleRename: fileCrud.handleRename,
    handleDelete: fileCrud.handleDelete,
    handleForceDelete: fileCrud.handleForceDelete,

    // Folder CRUD (from sub-hook)
    folderToDelete: folderCrud.folderToDelete,
    setFolderToDelete: folderCrud.setFolderToDelete,
    folderToRename: folderCrud.folderToRename,
    setFolderToRename: folderCrud.setFolderToRename,
    folderToShare: folderCrud.folderToShare,
    setFolderToShare: folderCrud.setFolderToShare,
    isCreateFolderModalOpen: folderCrud.isCreateFolderModalOpen,
    setCreateFolderModalOpen: folderCrud.setCreateFolderModalOpen,
    handleCreateFolder: folderCrud.handleCreateFolder,
    handleFolderRename: folderCrud.handleFolderRename,
    handleFolderDelete: folderCrud.handleFolderDelete,
    folderInSharesWarning: folderCrud.folderInSharesWarning,
    setFolderInSharesWarning: folderCrud.setFolderInSharesWarning,
    handleFolderForceDelete: folderCrud.handleFolderForceDelete,

    // Bulk operations (local to orchestrator)
    filesToDelete,
    setFilesToDelete,
    filesToShare,
    setFilesToShare,
    filesToDownload,
    setFilesToDownload,
    foldersToDelete,
    setFoldersToDelete,
    filesInSharesWarning,
    setFilesInSharesWarning,
    foldersInSharesWarning,
    setFoldersInSharesWarning,
    isBulkDownloadModalOpen,
    setBulkDownloadModalOpen,
    handleBulkDelete,
    handleBulkShare,
    handleBulkDownload,
    handleBulkDownloadWithZip,
    handleDeleteBulk,
    handleForceBulkDelete,
    handleForceBulkFolderDelete,
    handleShareBulkSuccess,

    foldersToShare,
    setFoldersToShare,
    foldersToDownload,
    setFoldersToDownload,

    clearSelection,
    setClearSelectionCallback,
  };
}
