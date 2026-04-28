import { useCallback, useEffect, useState } from "react";
import type { FileItem, FolderItem } from "./files-table-types";

type BulkAction = "delete" | "share" | "download" | "move";

interface SelectionManagerOptions {
  files: FileItem[];
  folders: FolderItem[];
  onBulkDelete?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkShare?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkDownload?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkMove?: (files: FileItem[], folders: FolderItem[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
  showBulkActions?: boolean;
  isShareMode?: boolean;
}

/**
 * Manages file and folder selection state, including bulk actions.
 * Replaces the duplicated selectedFiles/selectedFolders/handleSelectAll/etc.
 * logic that previously existed in both FilesTable and FilesGrid.
 */
export function useSelectionManager({
  files,
  folders,
  onBulkDelete,
  onBulkShare,
  onBulkDownload,
  onBulkMove,
  setClearSelectionCallback,
  showBulkActions = true,
  isShareMode = false,
}: SelectionManagerOptions) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  // Reset file selection when the file list changes
  const fileIds = files.map((f) => f.id).join(",");
  useEffect(() => {
    setSelectedFiles(new Set());
  }, [fileIds]);

  // Reset folder selection when the folder list changes
  const folderIds = folders.map((f) => f.id).join(",");
  useEffect(() => {
    setSelectedFolders(new Set());
  }, [folderIds]);

  // Register the clear-selection callback with the parent
  useEffect(() => {
    const clear = () => {
      setSelectedFiles(new Set());
      setSelectedFolders(new Set());
    };
    setClearSelectionCallback?.(clear);
  }, [setClearSelectionCallback]);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedFiles(new Set(files.map((f) => f.id)));
        setSelectedFolders(new Set(folders.map((f) => f.id)));
      } else {
        setSelectedFiles(new Set());
        setSelectedFolders(new Set());
      }
    },
    [files, folders],
  );

  const selectFile = useCallback((fileId: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }
      return next;
    });
  }, []);

  const selectFolder = useCallback((folderId: string, checked: boolean) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(folderId);
      } else {
        next.delete(folderId);
      }
      return next;
    });
  }, []);

  const getSelectedFiles = useCallback(
    () => files.filter((f) => selectedFiles.has(f.id)),
    [files, selectedFiles],
  );

  const getSelectedFolders = useCallback(
    () => folders.filter((f) => selectedFolders.has(f.id)),
    [folders, selectedFolders],
  );

  const totalItems = files.length + folders.length;
  const selectedCount = selectedFiles.size + selectedFolders.size;
  const isAllSelected = totalItems > 0 && selectedCount === totalItems;

  const handleBulkAction = useCallback(
    (action: BulkAction) => {
      const selectedFileObjects = files.filter((f) => selectedFiles.has(f.id));
      const selectedFolderObjects = folders.filter((f) => selectedFolders.has(f.id));
      if (selectedFileObjects.length === 0 && selectedFolderObjects.length === 0) return;

      switch (action) {
        case "delete":
          onBulkDelete?.(selectedFileObjects, selectedFolderObjects);
          break;
        case "share":
          onBulkShare?.(selectedFileObjects, selectedFolderObjects);
          break;
        case "download":
          onBulkDownload?.(selectedFileObjects, selectedFolderObjects);
          break;
        case "move":
          onBulkMove?.(selectedFileObjects, selectedFolderObjects);
          break;
      }
    },
    [
      files,
      folders,
      selectedFiles,
      selectedFolders,
      onBulkDelete,
      onBulkShare,
      onBulkDownload,
      onBulkMove,
    ],
  );

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
  }, []);

  const shouldShowBulkActions =
    showBulkActions &&
    (selectedFiles.size > 0 || selectedFolders.size > 0) &&
    !!(isShareMode ? onBulkDownload : onBulkDelete || onBulkShare || onBulkDownload || onBulkMove);

  return {
    selectedFiles,
    selectedFolders,
    selectedCount,
    isAllSelected,
    shouldShowBulkActions,
    handleSelectAll,
    selectFile,
    selectFolder,
    getSelectedFiles,
    getSelectedFolders,
    handleBulkAction,
    clearSelection,
  };
}
