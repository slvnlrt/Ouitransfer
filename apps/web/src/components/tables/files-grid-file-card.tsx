import {
  IconArrowsMove,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconEye,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getFileIcon } from "@/utils/file-icons";
import { formatFileSize } from "@/utils/format-file-size";
import type { FileItem } from "./files-table-types";

interface FileCardProps {
  file: FileItem;
  isSelected: boolean;
  isDraggedOver: boolean;
  isBeingDragged: boolean;
  isAnySelectedItemDragged: boolean;
  isDragging: boolean;
  isShareMode: boolean;
  previewUrl?: string;
  isImage: boolean;
  formatDateTime: (dateString: string) => string;
  onSelectFile: (e: React.MouseEvent, fileId: string, checked: boolean) => void;
  onPreview?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
  onMoveFile?: (file: FileItem) => void;
  onDragStart: (e: React.DragEvent, item: { id: string; type: "file" | "folder"; name: string }) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export function FileCard({
  file,
  isSelected,
  isDraggedOver,
  isBeingDragged,
  isAnySelectedItemDragged,
  isDragging,
  isShareMode,
  previewUrl,
  isImage,
  formatDateTime,
  onSelectFile,
  onPreview,
  onRename,
  onDownload,
  onShare,
  onDelete,
  onMoveFile,
  onDragStart,
  onDragEnd,
}: FileCardProps) {
  const t = useTranslations();
  const { icon: FileIcon, color } = getFileIcon(file.name);

  const fileContextMenu = !isShareMode && (
    <ContextMenuContent className="w-[200px]">
      <ContextMenuItem
        className="cursor-pointer py-2"
        onClick={(e) => {
          e.stopPropagation();
          onPreview?.(file);
        }}
      >
        <IconEye className="h-4 w-4" />
        {t("filesTable.actions.preview")}
      </ContextMenuItem>
      {onRename && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onRename?.(file);
          }}
        >
          <IconEdit className="h-4 w-4" />
          {t("filesTable.actions.edit")}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        className="cursor-pointer py-2"
        onClick={(e) => {
          e.stopPropagation();
          onDownload(file.objectName, file.name);
        }}
      >
        <IconDownload className="h-4 w-4" />
        {t("filesTable.actions.download")}
      </ContextMenuItem>
      {onShare && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onShare?.(file);
          }}
        >
          <IconShare className="h-4 w-4" />
          {t("filesTable.actions.share")}
        </ContextMenuItem>
      )}
      {onMoveFile && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onMoveFile?.(file);
          }}
        >
          <IconArrowsMove className="h-4 w-4" />
          {t("common.move")}
        </ContextMenuItem>
      )}
      {onDelete && (
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(file);
          }}
          className="cursor-pointer py-2 text-destructive focus:text-destructive"
          variant="destructive"
        >
          <IconTrash className="h-4 w-4" />
          {t("filesTable.actions.delete")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          data-card="true"
          className={`relative group border rounded-lg p-3 hover:bg-muted/50 transition-all duration-200 cursor-pointer ${
            isSelected ? "ring-2 ring-primary bg-muted/50" : ""
          } ${isDraggedOver ? "opacity-50 scale-95" : ""} ${
            isBeingDragged || isAnySelectedItemDragged
              ? "opacity-40 scale-95 transform rotate-2 border-2 border-primary/50 shadow-lg"
              : ""
          }`}
          style={{
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            willChange: isDragging ? "transform, opacity" : "auto",
          }}
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
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(e, { id: file.id, type: "file", name: file.name });
          }}
          onDragEnd={onDragEnd}
          onContextMenu={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="absolute top-2 left-2 z-10 checkbox-wrapper">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) => {
                onSelectFile({ stopPropagation: () => {} } as React.MouseEvent, file.id, checked);
              }}
              aria-label={t("filesTable.selectFile", { fileName: file.name })}
              className="bg-background border-2"
            />
          </div>

          <div className="absolute top-2 right-2 z-10">
            {isShareMode ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 hover:bg-background/80"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(file.objectName, file.name);
                }}
              >
                <IconDownload className="h-4 w-4" />
                <span className="sr-only">{t("filesTable.actions.download")}</span>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconDotsVertical className="h-4 w-4" />
                    <span className="sr-only">{t("filesTable.actions.menu")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  <DropdownMenuItem
                    className="cursor-pointer py-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview?.(file);
                    }}
                  >
                    <IconEye className="h-4 w-4" />
                    {t("filesTable.actions.preview")}
                  </DropdownMenuItem>
                  {onRename && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRename?.(file);
                      }}
                    >
                      <IconEdit className="h-4 w-4" />
                      {t("filesTable.actions.edit")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="cursor-pointer py-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(file.objectName, file.name);
                    }}
                  >
                    <IconDownload className="h-4 w-4" />
                    {t("filesTable.actions.download")}
                  </DropdownMenuItem>
                  {onShare && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShare?.(file);
                      }}
                    >
                      <IconShare className="h-4 w-4" />
                      {t("filesTable.actions.share")}
                    </DropdownMenuItem>
                  )}
                  {onMoveFile && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveFile?.(file);
                      }}
                    >
                      <IconArrowsMove className="h-4 w-4" />
                      {t("common.move")}
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(file);
                      }}
                      className="cursor-pointer py-2 text-destructive focus:text-destructive"
                    >
                      <IconTrash className="h-4 w-4" />
                      {t("filesTable.actions.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="flex flex-col items-center space-y-3">
            <div className="w-16 h-16 flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden">
              {isImage && previewUrl ? (
                <img src={previewUrl} alt={file.name} className="object-cover w-full h-full" />
              ) : (
                <FileIcon className={`h-10 w-10 ${color}`} />
              )}
            </div>

            <div className="w-full space-y-1">
              <p className="text-sm font-medium truncate text-left" title={file.name}>
                {file.name}
              </p>
              {file.description && (
                <p className="text-xs text-muted-foreground truncate text-left" title={file.description}>
                  {file.description}
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-1 text-left">
                <p>{formatFileSize(file.size)}</p>
                <p>{formatDateTime(file.createdAt)}</p>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      {fileContextMenu}
    </ContextMenu>
  );
}
