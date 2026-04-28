import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format-date-time";
import { FilesTableBulkActions } from "./files-table-bulk-actions";
import { FileRow } from "./files-table-file-row";
import { FolderRow } from "./files-table-folder-row";
import type { FileItem, FolderItem } from "./files-table-types";
import { useEditableItem } from "./use-editable-item";
import { useSelectionManager } from "./use-selection-manager";

// Re-export types for consumers that import File/Folder from this module
export type { FileItem as File, FolderItem as Folder } from "./files-table-types";

interface FilesTableProps {
  files: FileItem[];
  folders?: FolderItem[];
  onPreview?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onUpdateName?: (fileId: string, newName: string) => void;
  onUpdateDescription?: (fileId: string, newDescription: string) => void;
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
  onUpdateFolderName?: (folderId: string, newName: string) => void;
  onUpdateFolderDescription?: (folderId: string, newDescription: string) => void;
  showBulkActions?: boolean;
  isShareMode?: boolean;
}

export function FilesTable({
  files,
  folders = [],
  onPreview,
  onRename,
  onUpdateName,
  onUpdateDescription,
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
  onUpdateFolderName,
  onUpdateFolderDescription,
  showBulkActions = true,
  isShareMode = false,
}: FilesTableProps) {
  const t = useTranslations();

  const selection = useSelectionManager({
    files,
    folders,
    onBulkDelete,
    onBulkShare,
    onBulkDownload,
    onBulkMove,
    setClearSelectionCallback,
    showBulkActions,
    isShareMode,
  });

  const splitFileName = (fullName: string) => {
    const lastDotIndex = fullName.lastIndexOf(".");
    return lastDotIndex === -1
      ? { name: fullName, extension: "" }
      : {
          name: fullName.substring(0, lastDotIndex),
          extension: fullName.substring(lastDotIndex),
        };
  };

  const editing = useEditableItem({
    onSaveFile: (fileId, field, value) => {
      if (field === "name") onUpdateName?.(fileId, value);
      else onUpdateDescription?.(fileId, value);
    },
    onSaveFolder: (folderId, field, value) => {
      if (field === "name") onUpdateFolderName?.(folderId, value);
      else onUpdateFolderDescription?.(folderId, value);
    },
    transformEditValue: (_itemId, itemType, field, currentValue) => {
      if (itemType === "file" && field === "name") {
        return splitFileName(currentValue).name;
      }
      return currentValue || "";
    },
    transformSaveValue: (itemId, itemType, field, value) => {
      if (itemType === "file" && field === "name") {
        const file = files.find((f) => f.id === itemId);
        if (file) return value + splitFileName(file.name).extension;
      }
      return value;
    },
  });

  useEffect(() => {
    editing.resetPendingChanges("file");
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    editing.resetPendingChanges("folder");
  }, [folders]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {selection.shouldShowBulkActions && (
        <FilesTableBulkActions
          selectedCount={selection.selectedCount}
          isShareMode={isShareMode}
          onBulkDelete={onBulkDelete}
          onBulkShare={onBulkShare}
          onBulkDownload={onBulkDownload}
          onBulkMove={onBulkMove}
          onAction={selection.handleBulkAction}
          onClearSelection={selection.clearSelection}
        />
      )}

      <div className="rounded-lg shadow-sm overflow-hidden border">
        <Table>
          <TableHeader>
            <TableRow className="border-b-0">
              {showBulkActions && (
                <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4 w-12">
                  <Checkbox
                    checked={selection.isAllSelected}
                    onCheckedChange={selection.handleSelectAll}
                    aria-label={t("filesTable.selectAll")}
                  />
                </TableHead>
              )}
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("filesTable.columns.name")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("filesTable.columns.description")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("filesTable.columns.size")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("filesTable.columns.createdAt")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("filesTable.columns.updatedAt")}
              </TableHead>
              <TableHead className="h-10 w-[70px] text-xs font-bold text-muted-foreground bg-muted/50 px-4 rounded-tr-lg">
                {t("filesTable.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {folders.map((folder) => {
              const isEditingName = editing.isEditing(folder.id, "name");
              const isEditingDescription = editing.isEditing(folder.id, "description");
              const isHoveringName = editing.isHovering(folder.id, "name");
              const isHoveringDescriptionField = editing.isHovering(folder.id, "description");
              const displayName =
                editing.getDisplayValue(folder.id, "folder", "name", folder.name) || folder.name;
              const displayDescription = editing.getDisplayValue(
                folder.id,
                "folder",
                "description",
                folder.description,
              );

              return (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  isSelected={selection.selectedFolders.has(folder.id)}
                  isEditingName={isEditingName}
                  isEditingDescription={isEditingDescription}
                  isHoveringName={isHoveringName}
                  isHoveringDescription={isHoveringDescriptionField}
                  displayName={displayName}
                  displayDescription={displayDescription}
                  editValue={editing.editValue}
                  inputRef={editing.inputRef}
                  showBulkActions={showBulkActions}
                  isShareMode={isShareMode}
                  onSelectFolder={selection.selectFolder}
                  onNavigateToFolder={onNavigateToFolder}
                  onSetHoveredFolderField={(value) =>
                    editing.setHoverTarget(
                      value ? { itemId: value.folderId, field: value.field } : null,
                    )
                  }
                  onStartEditFolder={(folderId, field, currentValue) =>
                    editing.startEdit(folderId, "folder", field, currentValue)
                  }
                  onSaveEditFolder={editing.saveEdit}
                  onCancelEditFolder={editing.cancelEdit}
                  onEditValueChange={editing.setEditValue}
                  onKeyDown={editing.handleKeyDown}
                  onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  onShareFolder={onShareFolder}
                  onDownloadFolder={onDownloadFolder}
                  onMoveFolder={onMoveFolder}
                  formatDateTime={formatDateTime}
                />
              );
            })}
            {files.map((file) => {
              const isEditingName = editing.isEditing(file.id, "name");
              const isEditingDescription = editing.isEditing(file.id, "description");
              const isHoveringName = editing.isHovering(file.id, "name");
              const isHoveringDescription = editing.isHovering(file.id, "description");
              const displayName =
                editing.getDisplayValue(file.id, "file", "name", file.name) || file.name;
              const displayDescription = editing.getDisplayValue(
                file.id,
                "file",
                "description",
                file.description,
              );

              return (
                <FileRow
                  key={file.id}
                  file={file}
                  isSelected={selection.selectedFiles.has(file.id)}
                  isEditingName={isEditingName}
                  isEditingDescription={isEditingDescription}
                  isHoveringName={isHoveringName}
                  isHoveringDescription={isHoveringDescription}
                  displayName={displayName}
                  displayDescription={displayDescription}
                  editValue={editing.editValue}
                  inputRef={editing.inputRef}
                  showBulkActions={showBulkActions}
                  isShareMode={isShareMode}
                  onSelectFile={selection.selectFile}
                  onPreview={onPreview}
                  onSetHoveredField={(value) =>
                    editing.setHoverTarget(
                      value ? { itemId: value.fileId, field: value.field } : null,
                    )
                  }
                  onStartEdit={(fileId, field, currentValue) =>
                    editing.startEdit(fileId, "file", field, currentValue)
                  }
                  onSaveEdit={editing.saveEdit}
                  onCancelEdit={editing.cancelEdit}
                  onEditValueChange={editing.setEditValue}
                  onKeyDown={editing.handleKeyDown}
                  onDownload={onDownload}
                  onRename={onRename}
                  onShare={onShare}
                  onDelete={onDelete}
                  onMoveFile={onMoveFile}
                  formatDateTime={formatDateTime}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
