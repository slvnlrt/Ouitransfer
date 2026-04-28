import {
  IconArrowsMove,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconFolder,
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
import { formatFileSize } from "@/utils/format-file-size";
import type { FolderItem } from "./files-table-types";

interface FolderCardProps {
  folder: FolderItem;
  isSelected: boolean;
  isDragOver: boolean;
  isDraggedOver: boolean;
  isBeingDragged: boolean;
  isAnySelectedItemDragged: boolean;
  isDragging: boolean;
  isShareMode: boolean;
  formatDateTime: (dateString: string) => string;
  onSelectFolder: (folderId: string, checked: boolean) => void;
  onNavigateToFolder?: (folderId: string) => void;
  onRenameFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folder: FolderItem) => void;
  onShareFolder?: (folder: FolderItem) => void;
  onDownloadFolder?: (folderId: string, folderName: string) => Promise<void>;
  onMoveFolder?: (folder: FolderItem) => void;
  onDragStart: (e: React.DragEvent, item: { id: string; type: "file" | "folder"; name: string }) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, target: { id: string; type: "folder"; name: string }) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, target: { id: string; type: "folder"; name: string }) => void;
}

export function FolderCard({
  folder,
  isSelected,
  isDragOver,
  isDraggedOver,
  isBeingDragged,
  isAnySelectedItemDragged,
  isDragging,
  isShareMode,
  formatDateTime,
  onSelectFolder,
  onNavigateToFolder,
  onRenameFolder,
  onDeleteFolder,
  onShareFolder,
  onDownloadFolder,
  onMoveFolder,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderCardProps) {
  const t = useTranslations();

  const folderContextMenu = !isShareMode && (
    <ContextMenuContent className="w-[200px]">
      {onRenameFolder && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onRenameFolder(folder);
          }}
        >
          <IconEdit className="h-4 w-4" />
          {t("filesTable.actions.edit")}
        </ContextMenuItem>
      )}
      {onMoveFolder && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onMoveFolder(folder);
          }}
        >
          <IconArrowsMove className="h-4 w-4" />
          {t("common.move")}
        </ContextMenuItem>
      )}
      {onShareFolder && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onShareFolder(folder);
          }}
        >
          <IconShare className="h-4 w-4" />
          {t("filesTable.actions.share")}
        </ContextMenuItem>
      )}
      {onDownloadFolder && (
        <ContextMenuItem
          className="cursor-pointer py-2"
          onClick={(e) => {
            e.stopPropagation();
            onDownloadFolder(folder.id, folder.name);
          }}
        >
          <IconDownload className="h-4 w-4" />
          {t("filesTable.actions.download")}
        </ContextMenuItem>
      )}
      {onDeleteFolder && (
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFolder(folder);
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
          } ${isDragOver && !isBeingDragged ? "ring-2 ring-primary bg-primary/10 scale-105" : ""} ${
            isDraggedOver ? "opacity-50" : ""
          } ${
            isBeingDragged || isAnySelectedItemDragged
              ? "opacity-40 scale-95 transform rotate-2 border-2 border-primary/50 shadow-lg"
              : ""
          }`}
          style={{
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            willChange: isDragging ? "transform, opacity" : "auto",
          }}
          onClick={() => onNavigateToFolder?.(folder.id)}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(e, { id: folder.id, type: "folder", name: folder.name });
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            e.stopPropagation();
            onDragOver(e, { id: folder.id, type: "folder", name: folder.name });
          }}
          onDragLeave={onDragLeave}
          onDrop={(e) => {
            e.stopPropagation();
            onDrop(e, { id: folder.id, type: "folder", name: folder.name });
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="absolute top-2 left-2 z-10 checkbox-wrapper">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) => onSelectFolder(folder.id, checked)}
              aria-label={`Select folder ${folder.name}`}
              className="bg-background border-2"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="absolute top-2 right-2 z-10">
            {isShareMode ? (
              onDownloadFolder && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 hover:bg-background/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadFolder(folder.id, folder.name);
                  }}
                >
                  <IconDownload className="h-4 w-4" />
                  <span className="sr-only">{t("filesTable.actions.download")}</span>
                </Button>
              )
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
                  {onRenameFolder && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRenameFolder(folder);
                      }}
                    >
                      <IconEdit className="h-4 w-4" />
                      {t("filesTable.actions.edit")}
                    </DropdownMenuItem>
                  )}
                  {onMoveFolder && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveFolder(folder);
                      }}
                    >
                      <IconArrowsMove className="h-4 w-4" />
                      {t("common.move")}
                    </DropdownMenuItem>
                  )}
                  {onShareFolder && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShareFolder(folder);
                      }}
                    >
                      <IconShare className="h-4 w-4" />
                      {t("filesTable.actions.share")}
                    </DropdownMenuItem>
                  )}
                  {onDownloadFolder && (
                    <DropdownMenuItem
                      className="cursor-pointer py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadFolder(folder.id, folder.name);
                      }}
                    >
                      <IconDownload className="h-4 w-4" />
                      {t("filesTable.actions.download")}
                    </DropdownMenuItem>
                  )}
                  {onDeleteFolder && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFolder(folder);
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
              <IconFolder className="h-10 w-10 text-primary" />
            </div>
            <div className="w-full space-y-1">
              <p className="text-sm font-medium truncate text-left" title={folder.name}>
                {folder.name}
              </p>
              {folder.description && (
                <p className="text-xs text-muted-foreground truncate text-left" title={folder.description}>
                  {folder.description}
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-1 text-left">
                <p>{folder.totalSize ? formatFileSize(Number(folder.totalSize)) : "—"}</p>
                <p>{formatDateTime(folder.createdAt)}</p>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      {folderContextMenu}
    </ContextMenu>
  );
}
