"use client";

import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileItem } from "@/components/tables/files-table-types";
import { FileTree, type TreeFolder } from "@/components/tables/files-tree";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { logger } from "@/lib/logger";
import { getFileIcon } from "@/utils/file-icons";

type MoveItemFile = Pick<FileItem, "id" | "name">;

/**
 * Folder shape accepted by MoveItemsModal. Callers pass raw API folder data
 * (where `description` and `parentId` are `string | null`), so this type
 * widens the canonical FolderItem's optional fields to also accept `null`.
 */
interface MoveItemFolder {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  totalSize?: string | null;
  _count?: { files: number; children: number };
}

interface MoveItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMove: (targetFolderId: string | null) => Promise<void>;
  itemsToMove: { files: MoveItemFile[]; folders: MoveItemFile[] } | null;
  title?: string;
  description?: string;
  getAllFolders: () => Promise<MoveItemFolder[]>;
  currentFolderId?: string | null;
}

export function MoveItemsModal({
  isOpen,
  onClose,
  onMove,
  itemsToMove,
  title,
  description,
  getAllFolders,
  currentFolderId = null,
}: MoveItemsModalProps) {
  const t = useTranslations();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [folders, setFolders] = useState<TreeFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadFolders = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getAllFolders();

      const excludedIds = new Set(itemsToMove?.folders.map((f) => f.id) || []);

      const treeFolders: TreeFolder[] = data
        .filter((folder) => !excludedIds.has(folder.id))
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          type: "folder" as const,
          parentId: folder.parentId ?? null,
          totalSize: folder.totalSize ?? undefined,
        }));

      setFolders(treeFolders);
    } catch (error) {
      logger.error("Error loading folders:", {
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, [getAllFolders, itemsToMove]);

  useEffect(() => {
    if (isOpen) {
      loadFolders();

      if (currentFolderId) {
        setSelectedItems([currentFolderId]);
      } else {
        setSelectedItems(["root"]);
      }
    }
  }, [isOpen, loadFolders, currentFolderId]);

  const firstItemToMove = useMemo(() => {
    if (!itemsToMove) return null;
    if (itemsToMove.files.length > 0) return itemsToMove.files[0];
    if (itemsToMove.folders.length > 0) return itemsToMove.folders[0];
    return null;
  }, [itemsToMove]);

  const foldersWithRoot = useMemo(() => {
    const rootFolder: TreeFolder = {
      id: "root",
      name: t("folderActions.rootFolder"),
      type: "folder" as const,
      parentId: null,
    };
    return [rootFolder, ...folders];
  }, [folders, t]);

  const handleMove = async () => {
    try {
      setIsMoving(true);

      const targetFolderId =
        selectedItems.length > 0 && selectedItems[0] !== "root" ? selectedItems[0] : null;

      await onMove(targetFolderId);
      onClose();
    } catch (error) {
      logger.error("Error moving items:", {
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
    if (!isMoving) {
      setSelectedItems([]);
      setSearchQuery("");
      onClose();
    }
  };

  const handleSelectionChange = (newSelection: string[]) => {
    setSelectedItems(newSelection);
  };

  const selectedFolder =
    selectedItems.length > 0 && selectedItems[0] !== "root"
      ? folders.find((f) => f.id === selectedItems[0])?.name
      : null;

  const itemCount = (itemsToMove?.files.length || 0) + (itemsToMove?.folders.length || 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] w-full">
        <DialogHeader>
          <DialogTitle>{title || t("moveItems.title", { count: itemCount })}</DialogTitle>
          <DialogDescription>
            {description || t("moveItems.description", { count: itemCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0 w-full overflow-hidden">
          {/* Items being moved */}
          <div className="text-sm">
            <div className="font-medium mb-2">{t("moveItems.itemsToMove")}</div>
            <div className="max-h-20 overflow-y-auto text-muted-foreground">
              {itemsToMove?.folders.map((folder) => (
                <div key={folder.id} className="flex items-center gap-2 truncate">
                  <Folder className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </div>
              ))}
              {itemsToMove?.files.map((file) => {
                const { icon: FileIcon, color } = getFileIcon(file.name);
                return (
                  <div key={file.id} className="flex items-center gap-2 truncate">
                    <FileIcon className={`h-4 w-4 ${color} flex-shrink-0`} />
                    <span className="truncate">{file.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <Label htmlFor="search">{t("common.search")}</Label>
            <Input
              id="search"
              type="search"
              placeholder={t("searchBar.placeholderFolders")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {/* Destination Selection */}
          <div className="space-y-2">
            <Label>{t("folderActions.selectDestination")}</Label>
            <div className="text-sm text-muted-foreground mb-2">
              {selectedItems.length > 0 && selectedItems[0] !== "root"
                ? t("moveItems.movingToFolder", { folder: selectedFolder ?? "" })
                : t("moveItems.movingToFolder", { folder: t("folderActions.rootFolder") })}
            </div>
          </div>

          {/* Folder Tree */}
          <div className="flex-1 min-h-0 w-full overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">{t("common.loadingSimple")}</div>
              </div>
            ) : (
              <FileTree
                files={[]}
                folders={foldersWithRoot.map((folder: TreeFolder) => ({
                  id: folder.id,
                  name: folder.name,
                  type: "folder" as const,
                  parentId: folder.parentId || null,
                  description: "",
                  userId: "",
                  createdAt: "",
                  updatedAt: "",
                  totalSize: folder.totalSize,
                }))}
                selectedItems={selectedItems}
                onSelectionChange={handleSelectionChange}
                showFiles={false}
                showFolders={true}
                maxHeight="300px"
                singleSelection={true}
                useCheckboxAsRadio={true}
                searchQuery={searchQuery}
                autoExpandToItem={firstItemToMove?.id || null}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isMoving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleMove} disabled={isLoading || isMoving}>
            {isMoving ? t("common.moving") : t("common.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
