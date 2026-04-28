import {
  IconArrowsMove,
  IconCheck,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconEye,
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
import { getFileIcon } from "@/utils/file-icons";
import { formatFileSize } from "@/utils/format-file-size";
import type { FileItem } from "./files-table-types";

interface FileRowProps {
  file: FileItem;
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
  onSelectFile: (fileId: string, checked: boolean) => void;
  onPreview?: (file: FileItem) => void;
  onSetHoveredField: (value: { fileId: string; field: "name" | "description" } | null) => void;
  onStartEdit: (fileId: string, field: "name" | "description", currentValue: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onRename?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
  onMoveFile?: (file: FileItem) => void;
  formatDateTime: (dateString: string) => string;
}

export function FileRow({
  file,
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
  onSelectFile,
  onPreview,
  onSetHoveredField,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
  onDownload,
  onRename,
  onShare,
  onDelete,
  onMoveFile,
  formatDateTime,
}: FileRowProps) {
  const t = useTranslations();
  const { icon: FileIcon, color } = getFileIcon(file.name);

  return (
    <TableRow
      className="group hover:bg-muted/50 transition-colors border-0 cursor-pointer"
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(".checkbox-wrapper") ||
          (e.target as HTMLElement).closest("button") ||
          (e.target as HTMLElement).closest('[role="menuitem"]')
        ) {
          return;
        }
        if (onPreview) {
          onPreview(file);
        }
      }}
    >
      {showBulkActions && (
        <TableCell className="h-12 px-4 border-0">
          <div className="checkbox-wrapper">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) => onSelectFile(file.id, checked)}
              aria-label={t("filesTable.selectFile", { fileName: file.name })}
            />
          </div>
        </TableCell>
      )}
      <TableCell className="h-12 px-4 border-0">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onPreview?.(file);
            }}
            onMouseEnter={() => onSetHoveredField({ fileId: file.id, field: "name" })}
            onMouseLeave={() => onSetHoveredField(null)}
          >
            <FileIcon className={`h-5.5 w-5.5 ${color}`} />
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
                      onSaveEdit();
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
                      onCancelEdit();
                    }}
                  >
                    <IconX className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <span className="truncate max-w-[200px] font-medium" title={displayName}>
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
                          onStartEdit(file.id, "name", displayName);
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
      <TableCell className="h-12 px-4">
        <div
          className="flex items-center gap-1"
          onMouseEnter={() => onSetHoveredField({ fileId: file.id, field: "description" })}
          onMouseLeave={() => onSetHoveredField(null)}
        >
          {isEditingDescription ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                ref={inputRef}
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t("fileActions.addDescriptionPlaceholder")}
                className="h-8 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-green-600 hover:text-green-700 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveEdit();
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
                  onCancelEdit();
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
                      onStartEdit(file.id, "description", displayDescription || "");
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
      <TableCell className="h-12 px-4">{formatFileSize(file.size)}</TableCell>
      <TableCell className="h-12 px-4">{formatDateTime(file.createdAt)}</TableCell>
      <TableCell className="h-12 px-4">{formatDateTime(file.updatedAt || file.createdAt)}</TableCell>
      <TableCell className="h-12 px-4 text-right">
        {isShareMode ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-muted"
            onClick={() => onDownload(file.objectName, file.name)}
          >
            <IconDownload className="h-4 w-4" />
            <span className="sr-only">{t("filesTable.actions.download")}</span>
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted cursor-pointer">
                <IconDotsVertical className="h-4 w-4" />
                <span className="sr-only">{t("filesTable.actions.menu")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              {onPreview && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onPreview(file)}>
                  <IconEye className="h-4 w-4" />
                  {t("filesTable.actions.preview")}
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onRename(file)}>
                  <IconEdit className="h-4 w-4" />
                  {t("filesTable.actions.edit")}
                </DropdownMenuItem>
              )}
              {onMoveFile && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onMoveFile(file)}>
                  <IconArrowsMove className="h-4 w-4" />
                  {t("common.move")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="cursor-pointer py-2"
                onClick={() => onDownload(file.objectName, file.name)}
              >
                <IconDownload className="h-4 w-4" />
                {t("filesTable.actions.download")}
              </DropdownMenuItem>
              {onShare && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onShare(file)}>
                  <IconShare className="h-4 w-4" />
                  {t("filesTable.actions.share")}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(file)}
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
