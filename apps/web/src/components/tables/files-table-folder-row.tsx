import {
  IconArrowsMove,
  IconCheck,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconFolder,
  IconShare,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatFileSize } from "@/utils/format-file-size";
import type { FolderItem } from "./files-table-types";

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
  onSetHoveredFolderField: (value: { folderId: string; field: "name" | "description" } | null) => void;
  onStartEditFolder: (folderId: string, field: "name" | "description", currentValue: string) => void;
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
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToFolder?.(folder.id);
            }}
            onMouseEnter={() => onSetHoveredFolderField({ folderId: folder.id, field: "name" })}
            onMouseLeave={() => onSetHoveredFolderField(null)}
          >
            <IconFolder className="h-5.5 w-5.5 text-primary" />
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {isEditingName ? (
                <div className="flex items-center gap-1 flex-1">
                  <Input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => onEditValueChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="h-8 text-sm font-medium"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-green-600 hover:text-green-700 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSaveEditFolder();
                    }}
                  >
                    <IconCheck className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-red-600 hover:text-red-700 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelEditFolder();
                    }}
                  >
                    <IconX className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1 flex-1">
                  <span
                    className="font-medium text-sm text-foreground/90 truncate max-w-[150px]"
                    title={displayName}
                  >
                    {displayName}
                  </span>
                  <div className="w-6 flex justify-center flex-shrink-0">
                    {isHoveringName && !isShareMode && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartEditFolder(folder.id, "name", folder.name);
                        }}
                      >
                        <IconEdit className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
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
          {isEditingDescription ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                ref={inputRef}
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onKeyDown={onKeyDown}
                className="h-8 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-green-600 hover:text-green-700 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveEditFolder();
                }}
              >
                <IconCheck className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-red-600 hover:text-red-700 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelEditFolder();
                }}
              >
                <IconX className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span
                className="text-muted-foreground truncate max-w-[150px]"
                title={displayDescription || "-"}
              >
                {displayDescription || "-"}
              </span>
              <div className="w-6 flex justify-center flex-shrink-0">
                {isHoveringDescription && !isShareMode && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartEditFolder(folder.id, "description", folder.description || "");
                    }}
                  >
                    <IconEdit className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="h-12 px-4">
        {folder.totalSize ? formatFileSize(Number(folder.totalSize)) : "—"}
      </TableCell>
      <TableCell className="h-12 px-4">{formatDateTime(folder.createdAt)}</TableCell>
      <TableCell className="h-12 px-4">{formatDateTime(folder.updatedAt)}</TableCell>
      <TableCell className="h-12 px-4 text-right">
        {isShareMode ? (
          onDownloadFolder && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 hover:bg-muted"
              onClick={() => onDownloadFolder(folder.id, folder.name)}
            >
              <IconDownload className="h-4 w-4" />
              <span className="sr-only">{t("filesTable.actions.download")}</span>
            </Button>
          )
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted cursor-pointer">
                <IconDotsVertical className="h-4 w-4" />
                <span className="sr-only">Folder actions menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              {onRenameFolder && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onRenameFolder(folder)}>
                  <IconEdit className="h-4 w-4" />
                  {t("filesTable.actions.edit")}
                </DropdownMenuItem>
              )}
              {onMoveFolder && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onMoveFolder(folder)}>
                  <IconArrowsMove className="h-4 w-4" />
                  Move
                </DropdownMenuItem>
              )}
              {onDownloadFolder && (
                <DropdownMenuItem
                  className="cursor-pointer py-2"
                  onClick={() => onDownloadFolder(folder.id, folder.name)}
                >
                  <IconDownload className="h-4 w-4" />
                  {t("filesTable.actions.download")}
                </DropdownMenuItem>
              )}
              {onShareFolder && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onShareFolder(folder)}>
                  <IconShare className="h-4 w-4" />
                  {t("filesTable.actions.share")}
                </DropdownMenuItem>
              )}
              {onDeleteFolder && (
                <DropdownMenuItem
                  onClick={() => onDeleteFolder(folder)}
                  className="cursor-pointer py-2 text-destructive focus:text-destructive"
                >
                  <IconTrash className="h-4 w-4" />
                  {t("filesTable.actions.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}
