import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatFileSize } from "@/utils/format-file-size";
import { EditableField } from "./editable-field";
import { buildFolderActions } from "./files-table-actions";
import type { FolderItem } from "./files-table-types";
import { ItemDropdownMenu } from "./item-actions";

interface FolderRowProps {
  folder: FolderItem;
  isSelected: boolean;
  isEditingName: boolean;
  isEditingDescription: boolean;
  isHoveringName: boolean;
  isHoveringDescription: boolean;
  displayName: string;
  displayDescription?: string;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  showBulkActions: boolean;
  isShareMode: boolean;
  onSelectFolder: (folderId: string, checked: boolean) => void;
  onNavigateToFolder?: (folderId: string) => void;
  onSetHoveredFolderField: (
    value: { folderId: string; field: "name" | "description" } | null,
  ) => void;
  onStartEditFolder: (
    folderId: string,
    field: "name" | "description",
    currentValue: string,
  ) => void;
  onSaveEditFolder: () => void;
  onCancelEditFolder: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onRenameFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folder: FolderItem) => void;
  onShareFolder?: (folder: FolderItem) => void;
  onDownloadFolder?: (folderId: string, folderName: string) => Promise<void>;
  onMoveFolder?: (folder: FolderItem) => void;
  formatDateTime: (dateString: string) => string;
}

export function FolderRow({
  folder,
  isSelected,
  isEditingName,
  isEditingDescription,
  isHoveringName,
  isHoveringDescription,
  displayName,
  displayDescription,
  editValue,
  inputRef,
  showBulkActions,
  isShareMode,
  onSelectFolder,
  onNavigateToFolder,
  onSetHoveredFolderField,
  onStartEditFolder,
  onSaveEditFolder,
  onCancelEditFolder,
  onEditValueChange,
  onKeyDown,
  onRenameFolder,
  onDeleteFolder,
  onShareFolder,
  onDownloadFolder,
  onMoveFolder,
  formatDateTime,
}: FolderRowProps) {
  const t = useTranslations();

  const actions = buildFolderActions(
    folder,
    { onRenameFolder, onMoveFolder, onDownloadFolder, onShareFolder, onDeleteFolder },
    t,
  );

  return (
    <TableRow className="group hover:bg-muted/50 transition-colors border-0">
      {showBulkActions && (
        <TableCell className="h-12 px-4 border-0">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked: boolean) => onSelectFolder(folder.id, checked)}
            aria-label={`Select folder ${folder.name}`}
          />
        </TableCell>
      )}
      <TableCell className="h-12 px-4 border-0">
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/useSemanticElements: contains nested interactive EditableField (Input + Buttons); HTML forbids nested buttons */}
          <div
            role="button"
            tabIndex={0}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToFolder?.(folder.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onNavigateToFolder?.(folder.id);
              }
            }}
            onMouseEnter={() => onSetHoveredFolderField({ folderId: folder.id, field: "name" })}
            onMouseLeave={() => onSetHoveredFolderField(null)}
          >
            <Folder className="h-5.5 w-5.5 text-primary" />
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <EditableField
                isEditing={isEditingName}
                isHovering={isHoveringName}
                displayValue={displayName}
                editValue={editValue}
                isShareMode={isShareMode}
                inputRef={inputRef}
                displayClassName="font-medium text-sm text-foreground/90 truncate max-w-[150px] lg:max-w-[280px] xl:max-w-[360px]"
                onStartEdit={() => onStartEditFolder(folder.id, "name", folder.name)}
                onSaveEdit={onSaveEditFolder}
                onCancelEdit={onCancelEditFolder}
                onEditValueChange={onEditValueChange}
                onKeyDown={onKeyDown}
              />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell
        className="h-12 px-4"
        onMouseEnter={() => onSetHoveredFolderField({ folderId: folder.id, field: "description" })}
        onMouseLeave={() => onSetHoveredFolderField(null)}
      >
        <div className="flex items-center gap-1">
          <EditableField
            isEditing={isEditingDescription}
            isHovering={isHoveringDescription}
            displayValue={displayDescription || ""}
            editValue={editValue}
            isShareMode={isShareMode}
            inputRef={inputRef}
            displayClassName="text-muted-foreground truncate max-w-[150px] lg:max-w-[240px] xl:max-w-[300px]"
            onStartEdit={() =>
              onStartEditFolder(folder.id, "description", folder.description || "")
            }
            onSaveEdit={onSaveEditFolder}
            onCancelEdit={onCancelEditFolder}
            onEditValueChange={onEditValueChange}
            onKeyDown={onKeyDown}
          />
        </div>
      </TableCell>
      <TableCell className="h-12 px-4">
        {folder.totalSize ? formatFileSize(Number(folder.totalSize)) : "—"}
      </TableCell>
      <TableCell className="h-12 px-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm truncate">{formatDateTime(folder.createdAt)}</span>
          <span className="text-xs text-muted-foreground truncate">
            {formatDateTime(folder.updatedAt)}
          </span>
        </div>
      </TableCell>
      <TableCell className="h-12 px-4 text-end">
        <ItemDropdownMenu
          actions={actions}
          isShareMode={isShareMode}
          onShareModeDownload={
            onDownloadFolder ? () => onDownloadFolder(folder.id, folder.name) : undefined
          }
          menuSrLabel="Folder actions menu"
        />
      </TableCell>
    </TableRow>
  );
}
