import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilesTableBulkActions } from "./files-table-bulk-actions";
import { FileRow } from "./files-table-file-row";
import { FolderRow } from "./files-table-folder-row";
import type { FileItem, FolderItem } from "./files-table-types";

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
  const [editingField, setEditingField] = useState<{ fileId: string; field: "name" | "description" } | null>(null);
  const [editingFolderField, setEditingFolderField] = useState<{
    folderId: string;
    field: "name" | "description";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoveredField, setHoveredField] = useState<{ fileId: string; field: "name" | "description" } | null>(null);
  const [hoveredFolderField, setHoveredFolderField] = useState<{
    folderId: string;
    field: "name" | "description";
  } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<{ [fileId: string]: { name?: string; description?: string } }>(
    {}
  );
  const [pendingFolderChanges, setPendingFolderChanges] = useState<{
    [folderId: string]: { name?: string; description?: string };
  }>({});

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  useEffect(() => {
    setPendingChanges({});
  }, [files]);

  useEffect(() => {
    setPendingFolderChanges({});
  }, [folders]);

  const fileIds = files?.map((f) => f.id).join(",");
  useEffect(() => {
    setSelectedFiles(new Set());
  }, [fileIds]);

  const folderIds = folders?.map((f) => f.id).join(",");
  useEffect(() => {
    setSelectedFolders(new Set());
  }, [folderIds]);

  useEffect(() => {
    const clearSelection = () => {
      setSelectedFiles(new Set());
      setSelectedFolders(new Set());
    };
    setClearSelectionCallback?.(clearSelection);
  }, [setClearSelectionCallback]);

  const splitFileName = (fullName: string) => {
    const lastDotIndex = fullName.lastIndexOf(".");
    return lastDotIndex === -1
      ? { name: fullName, extension: "" }
      : {
          name: fullName.substring(0, lastDotIndex),
          extension: fullName.substring(lastDotIndex),
        };
  };

  const startEditFolder = (folderId: string, field: "name" | "description", currentValue: string) => {
    setEditingFolderField({ folderId, field });
    setEditValue(currentValue || "");
  };

  const saveEditFolder = () => {
    if (!editingFolderField) return;

    const { folderId, field } = editingFolderField;

    setPendingFolderChanges((prev) => ({
      ...prev,
      [folderId]: { ...prev[folderId], [field]: editValue },
    }));

    if (field === "name") {
      onUpdateFolderName?.(folderId, editValue);
    } else {
      onUpdateFolderDescription?.(folderId, editValue);
    }

    setEditingFolderField(null);
    setEditValue("");
    setHoveredFolderField(null);
  };

  const cancelEditFolder = () => {
    setEditingFolderField(null);
    setEditValue("");
    setHoveredFolderField(null);
  };

  const startEdit = (fileId: string, field: "name" | "description", currentValue: string) => {
    setEditingField({ fileId, field });
    if (field === "name") {
      const { name } = splitFileName(currentValue);
      setEditValue(name);
    } else {
      setEditValue(currentValue || "");
    }
  };

  const saveEdit = () => {
    if (!editingField) return;

    const { fileId, field } = editingField;
    if (field === "name") {
      const file = files.find((f) => f.id === fileId);
      if (file) {
        const { extension } = splitFileName(file.name);
        const newFullName = editValue + extension;

        setPendingChanges((prev) => ({
          ...prev,
          [fileId]: { ...prev[fileId], name: newFullName },
        }));

        onUpdateName?.(fileId, newFullName);
      }
    } else {
      setPendingChanges((prev) => ({
        ...prev,
        [fileId]: { ...prev[fileId], description: editValue },
      }));

      onUpdateDescription?.(fileId, editValue);
    }

    setEditingField(null);
    setEditValue("");
    setHoveredField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
    setHoveredField(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (editingFolderField) {
        saveEditFolder();
      } else {
        saveEdit();
      }
    } else if (e.key === "Escape") {
      if (editingFolderField) {
        cancelEditFolder();
      } else {
        cancelEdit();
      }
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);

    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const getDisplayValue = (file: FileItem, field: "name" | "description") => {
    const pendingChange = pendingChanges[file.id];
    if (pendingChange && pendingChange[field] !== undefined) {
      return pendingChange[field];
    }
    return field === "name" ? file.name : file.description;
  };

  const getDisplayFolderValue = (folder: FolderItem, field: "name" | "description") => {
    const pendingChange = pendingFolderChanges[folder.id];
    if (pendingChange && pendingChange[field] !== undefined) {
      return pendingChange[field];
    }
    return field === "name" ? folder.name : folder.description;
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

  const handleSelectFile = (fileId: string, checked: boolean) => {
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
          selectedCount={selectedFiles.size + selectedFolders.size}
          isShareMode={isShareMode}
          onBulkDelete={onBulkDelete}
          onBulkShare={onBulkShare}
          onBulkDownload={onBulkDownload}
          onBulkMove={onBulkMove}
          onAction={handleBulkAction}
          onClearSelection={clearSelection}
        />
      )}

      <div className="rounded-lg shadow-sm overflow-hidden border">
        <Table>
          <TableHeader>
            <TableRow className="border-b-0">
              {showBulkActions && (
                <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4 w-12">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
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
              const isEditingName = editingFolderField?.folderId === folder.id && editingFolderField?.field === "name";
              const isEditingDescription =
                editingFolderField?.folderId === folder.id && editingFolderField?.field === "description";
              const isHoveringName = hoveredFolderField?.folderId === folder.id && hoveredFolderField?.field === "name";
              const isHoveringDescriptionField =
                hoveredFolderField?.folderId === folder.id && hoveredFolderField?.field === "description";
              const displayName = getDisplayFolderValue(folder, "name") || folder.name;
              const displayDescription = getDisplayFolderValue(folder, "description");

              return (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  isSelected={selectedFolders.has(folder.id)}
                  isEditingName={isEditingName}
                  isEditingDescription={isEditingDescription}
                  isHoveringName={isHoveringName}
                  isHoveringDescription={isHoveringDescriptionField}
                  displayName={displayName}
                  displayDescription={displayDescription}
                  editValue={editValue}
                  inputRef={inputRef}
                  showBulkActions={showBulkActions}
                  isShareMode={isShareMode}
                  onSelectFolder={handleSelectFolder}
                  onNavigateToFolder={onNavigateToFolder}
                  onSetHoveredFolderField={setHoveredFolderField}
                  onStartEditFolder={startEditFolder}
                  onSaveEditFolder={saveEditFolder}
                  onCancelEditFolder={cancelEditFolder}
                  onEditValueChange={setEditValue}
                  onKeyDown={handleKeyDown}
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
              const isEditingName = editingField?.fileId === file.id && editingField?.field === "name";
              const isEditingDescription = editingField?.fileId === file.id && editingField?.field === "description";
              const isHoveringName = hoveredField?.fileId === file.id && hoveredField?.field === "name";
              const isHoveringDescription = hoveredField?.fileId === file.id && hoveredField?.field === "description";
              const displayName = getDisplayValue(file, "name") || file.name;
              const displayDescription = getDisplayValue(file, "description");

              return (
                <FileRow
                  key={file.id}
                  file={file}
                  isSelected={selectedFiles.has(file.id)}
                  isEditingName={isEditingName}
                  isEditingDescription={isEditingDescription}
                  isHoveringName={isHoveringName}
                  isHoveringDescription={isHoveringDescription}
                  displayName={displayName}
                  displayDescription={displayDescription}
                  editValue={editValue}
                  inputRef={inputRef}
                  showBulkActions={showBulkActions}
                  isShareMode={isShareMode}
                  onSelectFile={handleSelectFile}
                  onPreview={onPreview}
                  onSetHoveredField={setHoveredField}
                  onStartEdit={startEdit}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  onEditValueChange={setEditValue}
                  onKeyDown={handleKeyDown}
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
