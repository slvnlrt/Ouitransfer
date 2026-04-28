import { IconCloudUpload, IconFolderPlus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDragDrop } from "@/hooks/use-drag-drop";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";
import { logger } from "@/lib/logger";
import { FileCard } from "./files-grid-file-card";
import { FolderCard } from "./files-grid-folder-card";
import { FilesTableBulkActions } from "./files-table-bulk-actions";
import type { FileItem, FolderItem } from "./files-table-types";

const urlCache: Record<string, { url: string; timestamp: number }> = {};
const CACHE_DURATION = 1000 * 60;

interface FilesGridProps {
  files: FileItem[];
  folders?: FolderItem[];
  onPreview?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onCreateFolder?: () => void;
  onUpload?: () => void;
  onDownload: (objectName: string, fileName: string) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
  onBulkDelete?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkShare?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkDownload?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkMove?: (files: FileItem[], folders: FolderItem[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
  onNavigateToFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folder: FolderItem) => void;
  onShareFolder?: (folder: FolderItem) => void;
  onDownloadFolder?: (folderId: string, folderName: string) => Promise<void>;
  onMoveFolder?: (folder: FolderItem) => void;
  onMoveFile?: (file: FileItem) => void;
  onRefresh?: () => Promise<void>;
  onImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null,
  ) => void;
  showBulkActions?: boolean;
  isShareMode?: boolean;
}

export function FilesGrid({
  files,
  folders = [],
  onPreview,
  onRename,
  onCreateFolder,
  onUpload,
  onDownload,
  onShare,
  onDelete,
  onBulkDelete,
  onBulkShare,
  onBulkDownload,
  onBulkMove,
  setClearSelectionCallback,
  onNavigateToFolder,
  onRenameFolder,
  onDeleteFolder,
  onShareFolder,
  onDownloadFolder,
  onMoveFolder,
  onMoveFile,
  onRefresh,
  onImmediateUpdate,
  showBulkActions = true,
  isShareMode = false,
}: FilesGridProps) {
  const t = useTranslations();

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  const {
    draggedItem,
    draggedItems,
    dragOverTarget,
    isDragging,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragDrop({
    onRefresh,
    onImmediateUpdate,
    selectedFiles,
    selectedFolders,
    files,
    folders,
  });

  const [filePreviewUrls, setFilePreviewUrls] = useState<Record<string, string>>({});

  const loadingUrls = useRef<Set<string>>(new Set());
  const loadedFileIds = useRef<Set<string>>(new Set());
  const componentMounted = useRef(true);

  useEffect(() => {
    componentMounted.current = true;
    return () => {
      componentMounted.current = false;
      Object.keys(urlCache).forEach((key) => {
        delete urlCache[key];
      });
    };
  }, []);

  useEffect(() => {
    const clearSelection = () => {
      setSelectedFiles(new Set());
      setSelectedFolders(new Set());
    };
    setClearSelectionCallback?.(clearSelection);
  }, [setClearSelectionCallback]);

  const folderIds = folders?.map((f) => f.id).join(",");

  useEffect(() => {
    setSelectedFolders(new Set());
  }, [folderIds]);

  const isImageFile = (fileName: string) => {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    return imageExtensions.some((ext) => fileName.toLowerCase().endsWith(ext));
  };

  useEffect(() => {
    const loadPreviewUrls = async () => {
      const imageFiles = files.filter((file) => isImageFile(file.name));
      const now = Date.now();

      for (const file of imageFiles) {
        if (!componentMounted.current) break;
        if (loadingUrls.current.has(file.objectName)) {
          continue;
        }
        if (loadedFileIds.current.has(file.id)) {
          continue;
        }

        const cached = urlCache[file.objectName];
        if (cached && now - cached.timestamp < CACHE_DURATION) {
          loadedFileIds.current.add(file.id);
          setFilePreviewUrls((prev) => ({ ...prev, [file.id]: cached.url }));
          continue;
        }

        try {
          loadingUrls.current.add(file.objectName);
          const url = await getCachedDownloadUrl(file.objectName);

          if (!componentMounted.current) break;

          urlCache[file.objectName] = { url, timestamp: now };
          loadedFileIds.current.add(file.id);
          setFilePreviewUrls((prev) => ({ ...prev, [file.id]: url }));
        } catch (error) {
          logger.error(`Failed to load preview for ${file.name}:`, {
            err: error instanceof Error ? error.message : String(error),
          });
        } finally {
          loadingUrls.current.delete(file.objectName);
        }
      }
    };

    if (componentMounted.current) {
      loadPreviewUrls();
    }
  }, [files]);

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFiles(new Set(files.map((file) => file.id)));
      setSelectedFolders(new Set(folders.map((folder) => folder.id)));
    } else {
      setSelectedFiles(new Set());
      setSelectedFolders(new Set());
    }
  };

  const handleSelectFile = (e: React.MouseEvent, fileId: string, checked: boolean) => {
    e.stopPropagation();
    const newSelected = new Set(selectedFiles);
    if (checked) {
      newSelected.add(fileId);
    } else {
      newSelected.delete(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const handleSelectFolder = (folderId: string, checked: boolean) => {
    const newSelected = new Set(selectedFolders);
    if (checked) {
      newSelected.add(folderId);
    } else {
      newSelected.delete(folderId);
    }
    setSelectedFolders(newSelected);
  };

  const getSelectedFiles = () => files.filter((file) => selectedFiles.has(file.id));
  const getSelectedFolders = () => folders.filter((folder) => selectedFolders.has(folder.id));

  const totalItems = files.length + folders.length;
  const selectedItems = selectedFiles.size + selectedFolders.size;
  const isAllSelected = totalItems > 0 && selectedItems === totalItems;

  const draggedItemIds = useMemo(() => {
    return new Set(draggedItems.map((item) => item.id));
  }, [draggedItems]);

  const handleBulkAction = (action: "delete" | "share" | "download" | "move") => {
    const selectedFileObjects = getSelectedFiles();
    const selectedFolderObjects = getSelectedFolders();

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
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
  };

  const shouldShowBulkActions =
    showBulkActions &&
    (selectedFiles.size > 0 || selectedFolders.size > 0) &&
    (isShareMode ? onBulkDownload : onBulkDelete || onBulkShare || onBulkDownload || onBulkMove);

  return (
    <div className="space-y-4">
      {shouldShowBulkActions && (
        <FilesTableBulkActions
          selectedCount={selectedItems}
          isShareMode={isShareMode}
          onBulkDelete={onBulkDelete}
          onBulkShare={onBulkShare}
          onBulkDownload={onBulkDownload}
          onBulkMove={onBulkMove}
          onAction={handleBulkAction}
          onClearSelection={clearSelection}
        />
      )}

      <div className="flex items-center gap-2 px-2">
        <Checkbox
          checked={isAllSelected}
          onCheckedChange={handleSelectAll}
          aria-label={t("filesTable.selectAll")}
        />
        <span className="text-sm text-muted-foreground">{t("filesTable.selectAll")}</span>
      </div>

      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 ">
            {folders.map((folder) => {
              const isSelected = selectedFolders.has(folder.id);
              const isDragOver = dragOverTarget?.id === folder.id;
              const isDraggedOver = draggedItem?.id === folder.id;
              const isBeingDragged = draggedItemIds.has(folder.id);
              const isAnySelectedItemDragged = isDragging && isSelected && draggedItems.length > 1;

              return (
                <FolderCard
                  key={`folder-${folder.id}`}
                  folder={folder}
                  isSelected={isSelected}
                  isDragOver={isDragOver}
                  isDraggedOver={isDraggedOver}
                  isBeingDragged={isBeingDragged}
                  isAnySelectedItemDragged={isAnySelectedItemDragged}
                  isDragging={isDragging}
                  isShareMode={isShareMode}
                  formatDateTime={formatDateTime}
                  onSelectFolder={handleSelectFolder}
                  onNavigateToFolder={onNavigateToFolder}
                  onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  onShareFolder={onShareFolder}
                  onDownloadFolder={onDownloadFolder}
                  onMoveFolder={onMoveFolder}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                />
              );
            })}

            {files.map((file) => {
              const isSelected = selectedFiles.has(file.id);
              const isImage = isImageFile(file.name);
              const previewUrl = filePreviewUrls[file.id];
              const isDraggedOver = draggedItem?.id === file.id;
              const isBeingDragged = draggedItemIds.has(file.id);
              const isAnySelectedItemDragged = isDragging && isSelected && draggedItems.length > 1;

              return (
                <FileCard
                  key={file.id}
                  file={file}
                  isSelected={isSelected}
                  isDraggedOver={isDraggedOver}
                  isBeingDragged={isBeingDragged}
                  isAnySelectedItemDragged={isAnySelectedItemDragged}
                  isDragging={isDragging}
                  isShareMode={isShareMode}
                  previewUrl={previewUrl}
                  isImage={isImage}
                  formatDateTime={formatDateTime}
                  onSelectFile={handleSelectFile}
                  onPreview={onPreview}
                  onRename={onRename}
                  onDownload={onDownload}
                  onShare={onShare}
                  onDelete={onDelete}
                  onMoveFile={onMoveFile}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              );
            })}
          </div>
        </ContextMenuTrigger>
        {!isShareMode && (onCreateFolder || onUpload) && (
          <ContextMenuContent className="w-[200px]">
            {onCreateFolder && (
              <ContextMenuItem onClick={onCreateFolder} className="cursor-pointer py-2">
                <IconFolderPlus className="h-4 w-4" />
                {t("contextMenu.newFolder")}
              </ContextMenuItem>
            )}
            {onUpload && (
              <ContextMenuItem onClick={onUpload} className="cursor-pointer py-2">
                <IconCloudUpload className="h-4 w-4" />
                {t("contextMenu.uploadFile")}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        )}
      </ContextMenu>
    </div>
  );
}
