import { Download, Eye, Move, Pencil, Share, Trash2 } from "lucide-react";

import type { FileItem, FolderItem } from "./files-table-types";
import type { ActionItem } from "./item-actions";

/** Minimal shape of the next-intl translate function used for action labels. */
type Translate = (key: string) => string;

export interface FileActionHandlers {
  onPreview?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onMoveFile?: (file: FileItem) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
}

export interface FolderActionHandlers {
  onRenameFolder?: (folder: FolderItem) => void;
  onMoveFolder?: (folder: FolderItem) => void;
  onDownloadFolder?: (folderId: string, folderName: string) => Promise<void>;
  onShareFolder?: (folder: FolderItem) => void;
  onDeleteFolder?: (folder: FolderItem) => void;
}

/**
 * Builds the action menu items for a file. Shared between the desktop table row
 * and the mobile card so the two stay in sync.
 */
export function buildFileActions(
  file: FileItem,
  handlers: FileActionHandlers,
  t: Translate,
): ActionItem[] {
  const { onPreview, onRename, onMoveFile, onDownload, onShare, onDelete } = handlers;

  return [
    ...(onPreview
      ? [
          {
            key: "preview",
            icon: Eye,
            label: t("filesTable.actions.preview"),
            onClick: () => onPreview(file),
          },
        ]
      : []),
    ...(onRename
      ? [
          {
            key: "edit",
            icon: Pencil,
            label: t("filesTable.actions.edit"),
            onClick: () => onRename(file),
          },
        ]
      : []),
    ...(onMoveFile
      ? [{ key: "move", icon: Move, label: t("common.move"), onClick: () => onMoveFile(file) }]
      : []),
    {
      key: "download",
      icon: Download,
      label: t("filesTable.actions.download"),
      onClick: () => onDownload(file.objectName, file.name),
    },
    ...(onShare
      ? [
          {
            key: "share",
            icon: Share,
            label: t("filesTable.actions.share"),
            onClick: () => onShare(file),
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            key: "delete",
            icon: Trash2,
            label: t("filesTable.actions.delete"),
            onClick: () => onDelete(file),
            variant: "destructive" as const,
          },
        ]
      : []),
  ];
}

/**
 * Builds the action menu items for a folder. Shared between the desktop table
 * row and the mobile card.
 */
export function buildFolderActions(
  folder: FolderItem,
  handlers: FolderActionHandlers,
  t: Translate,
): ActionItem[] {
  const { onRenameFolder, onMoveFolder, onDownloadFolder, onShareFolder, onDeleteFolder } =
    handlers;

  return [
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
      ? [{ key: "move", icon: Move, label: t("common.move"), onClick: () => onMoveFolder(folder) }]
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
}
