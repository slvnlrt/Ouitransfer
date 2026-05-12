import { Download, Folder, Move, Pencil, Share, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { formatFileSize } from "@/utils/format-file-size";
import type { FolderItem } from "./files-table-types";
import { type ActionItem, ItemContextMenuActions, ItemDropdownMenu } from "./item-actions";

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
  onDragStart: (
    e: React.DragEvent,
    item: { id: string; type: "file" | "folder"; name: string },
  ) => void;
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

  const actions: ActionItem[] = [
    ...(onRenameFolder
      ? [
          {
            key: "edit",
            icon: Pencil,
            label: t("filesTable.actions.edit"),
            onClick: () => onRenameFolder(folder),
          },
        ]
      : []),
    ...(onMoveFolder
      ? [
          {
            key: "move",
            icon: Move,
            label: t("common.move"),
            onClick: () => onMoveFolder(folder),
          },
        ]
      : []),
    ...(onShareFolder
      ? [
          {
            key: "share",
            icon: Share,
            label: t("filesTable.actions.share"),
            onClick: () => onShareFolder(folder),
          },
        ]
      : []),
    ...(onDownloadFolder
      ? [
          {
            key: "download",
            icon: Download,
            label: t("filesTable.actions.download"),
            onClick: () => onDownloadFolder(folder.id, folder.name),
          },
        ]
      : []),
    ...(onDeleteFolder
      ? [
          {
            key: "delete",
            icon: Trash2,
            label: t("filesTable.actions.delete"),
            onClick: () => onDeleteFolder(folder),
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  const folderContextMenu = !isShareMode && <ItemContextMenuActions actions={actions} />;

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: container has nested interactive elements (Checkbox, DropdownMenu); HTML forbids nested buttons */}
        <div
          data-card="true"
          role="button"
          tabIndex={0}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigateToFolder?.(folder.id);
            }
          }}
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
          <div className="absolute top-2 start-2 z-10 checkbox-wrapper">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) => onSelectFolder(folder.id, checked)}
              aria-label={`Select folder ${folder.name}`}
              className="bg-background border-2"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="absolute top-2 end-2 z-10">
            <ItemDropdownMenu
              actions={actions}
              isShareMode={isShareMode}
              onShareModeDownload={
                onDownloadFolder ? () => onDownloadFolder(folder.id, folder.name) : undefined
              }
              triggerClassName="h-8 w-8"
            />
          </div>

          <div className="flex flex-col items-center space-y-3">
            <div className="w-16 h-16 flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden">
              <Folder className="h-10 w-10 text-primary" />
            </div>
            <div className="w-full space-y-1">
              <p className="text-sm font-medium truncate text-start" title={folder.name}>
                {folder.name}
              </p>
              {folder.description && (
                <p
                  className="text-xs text-muted-foreground truncate text-start"
                  title={folder.description}
                >
                  {folder.description}
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-1 text-start">
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
