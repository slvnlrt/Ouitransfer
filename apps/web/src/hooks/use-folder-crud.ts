import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { FolderItem } from "@/components/tables/files-table-types";
import { deleteFolder, registerFolder, updateFolder } from "@/http/endpoints/folders";
import { logger } from "@/lib/logger";

type FolderToRename = Pick<FolderItem, "id" | "name" | "description">;
type FolderToDelete = Pick<FolderItem, "id" | "name">;
type FolderToShare = Pick<
  FolderItem,
  "id" | "name" | "description" | "objectName" | "parentId" | "userId" | "createdAt" | "updatedAt"
>;

export interface FolderCrudHook {
  folderToDelete: FolderToDelete | null;
  folderToRename: FolderToRename | null;
  folderToShare: FolderToShare | null;
  isCreateFolderModalOpen: boolean;

  setFolderToDelete: (folder: FolderToDelete | null) => void;
  setFolderToRename: (folder: FolderToRename | null) => void;
  setFolderToShare: (folder: FolderToShare | null) => void;
  setCreateFolderModalOpen: (open: boolean) => void;

  handleCreateFolder: (
    data: { name: string; description?: string },
    parentId?: string,
  ) => Promise<void>;
  handleFolderDelete: (folderId: string) => Promise<void>;
  handleFolderRename: (folderId: string, newName: string, description?: string) => Promise<void>;
}

export function useFolderCrud(
  onRefresh: () => Promise<void>,
  handleImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null | "__DELETE__",
  ) => void,
  clearSelectionCallback?: (() => void) | null,
): FolderCrudHook {
  const t = useTranslations();

  const [folderToDelete, setFolderToDelete] = useState<FolderToDelete | null>(null);
  const [folderToRename, setFolderToRename] = useState<FolderToRename | null>(null);
  const [folderToShare, setFolderToShare] = useState<FolderToShare | null>(null);
  const [isCreateFolderModalOpen, setCreateFolderModalOpen] = useState(false);

  const handleCreateFolder = useCallback(
    async (data: { name: string; description?: string }, parentId?: string) => {
      try {
        // Note: Server validates and sanitizes the object key. Client-side sanitization is defense-in-depth only.
        const folderData = {
          name: data.name,
          description: data.description,
          objectName: `folders/${Date.now()}-${data.name}`,
          parentId: parentId || undefined,
        };

        await registerFolder(folderData);
        toast.success(t("folderActions.folderCreated"));
        setCreateFolderModalOpen(false);
        await onRefresh();
      } catch (error) {
        logger.error("Error creating folder", {
          name: data.name,
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("folderActions.createFolderError"));
        throw error;
      }
    },
    [onRefresh, t],
  );

  const handleFolderRename = useCallback(
    async (folderId: string, newName: string, description?: string) => {
      try {
        await updateFolder(folderId, { name: newName, description });
        toast.success(t("folderActions.folderRenamed"));
        setFolderToRename(null);
        await onRefresh();
      } catch (error) {
        logger.error("Error renaming folder", {
          folderId,
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("folderActions.renameFolderError"));
      }
    },
    [onRefresh, t],
  );

  const handleFolderDelete = useCallback(
    async (folderId: string) => {
      try {
        if (handleImmediateUpdate) {
          handleImmediateUpdate(folderId, "folder", "__DELETE__");
        }

        await deleteFolder(folderId);
        toast.success(t("folderActions.folderDeleted"));
        setFolderToDelete(null);
        if (clearSelectionCallback) {
          clearSelectionCallback();
        }
      } catch (error) {
        logger.error("Error deleting folder", {
          folderId,
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("folderActions.deleteFolderError"));
      }
    },
    [handleImmediateUpdate, clearSelectionCallback, t],
  );

  return {
    folderToDelete,
    setFolderToDelete,
    folderToRename,
    setFolderToRename,
    folderToShare,
    setFolderToShare,
    isCreateFolderModalOpen,
    setCreateFolderModalOpen,
    handleCreateFolder,
    handleFolderRename,
    handleFolderDelete,
  };
}
