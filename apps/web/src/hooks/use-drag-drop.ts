import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/** Defers ghost removal to the next tick so the browser can capture the drag image before removal (ms) */
const DRAG_GHOST_CLEANUP_DELAY_MS = 0;

import { moveFile } from "@/http/endpoints/files";
import { moveFolder } from "@/http/endpoints/folders";
import { logger } from "@/lib/logger";

interface DragItem {
  id: string;
  type: "file" | "folder";
  name: string;
}

interface DropTarget {
  id: string;
  type: "folder";
  name: string;
}

interface DragDropItem {
  id: string;
  name: string;
}

interface UseDragDropProps {
  onRefresh?: () => Promise<void>;
  onImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null,
  ) => void;
  selectedFiles?: Set<string>;
  selectedFolders?: Set<string>;
  files?: DragDropItem[];
  folders?: DragDropItem[];
}

export function useDragDrop({
  onRefresh,
  onImmediateUpdate,
  selectedFiles,
  selectedFolders,
  files = [],
  folders = [],
}: UseDragDropProps) {
  const t = useTranslations();
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [draggedItems, setDraggedItems] = useState<DragItem[]>([]);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const createDragGhost = useCallback((items: DragItem[]) => {
    const ghost = document.createElement("div");

    // Dark mode support — dynamic colors require inline styles; structural layout uses classes
    const isDarkMode = document.documentElement.classList.contains("dark");
    ghost.className = "absolute flex flex-col gap-1 p-3 rounded-lg backdrop-blur-md z-[9999]";
    ghost.style.top = "-9999px";
    ghost.style.left = "-9999px";
    ghost.style.minWidth = "200px";
    ghost.style.maxWidth = "250px";
    ghost.style.backgroundColor = isDarkMode
      ? "rgba(10, 10, 10, 0.95)"
      : "rgba(255, 255, 255, 0.95)";
    ghost.style.border = "2px solid hsl(var(--primary))";
    ghost.style.boxShadow = isDarkMode
      ? "0 8px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)"
      : "0 8px 16px rgba(0, 0, 0, 0.15)";

    const itemsToShow = items.slice(0, 3);
    const remaining = items.length - itemsToShow.length;

    itemsToShow.forEach((item) => {
      const itemDiv = document.createElement("div");
      itemDiv.className =
        "flex items-center gap-2 px-2 py-1.5 rounded text-[13px] font-medium transition-all duration-200";
      itemDiv.style.backgroundColor = isDarkMode
        ? "rgba(255, 255, 255, 0.05)"
        : "rgba(0, 0, 0, 0.03)";
      itemDiv.style.color = "hsl(var(--foreground))";
      itemDiv.style.boxShadow = isDarkMode
        ? "0 1px 3px rgba(0, 0, 0, 0.3)"
        : "0 1px 3px rgba(0, 0, 0, 0.1)";

      const icon = document.createElement("span");
      icon.textContent = item.type === "folder" ? "📁" : "📄";
      icon.className = "text-base";

      const name = document.createElement("span");
      name.textContent = item.name;
      name.className = "overflow-hidden text-ellipsis whitespace-nowrap";

      itemDiv.appendChild(icon);
      itemDiv.appendChild(name);
      ghost.appendChild(itemDiv);
    });

    if (remaining > 0) {
      const moreDiv = document.createElement("div");
      moreDiv.className = "px-2 py-1 text-xs font-semibold text-center rounded mt-0.5";
      moreDiv.style.color = "hsl(var(--primary))";
      moreDiv.style.backgroundColor = isDarkMode
        ? "rgba(255, 255, 255, 0.03)"
        : "rgba(0, 0, 0, 0.02)";
      moreDiv.textContent = `+${remaining} more`;
      ghost.appendChild(moreDiv);
    }

    document.body.appendChild(ghost);
    return ghost;
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, item: DragItem) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-move-item", "true");

      let itemsToDrag: DragItem[] = [item];

      // Check if item is in selection
      const isFileSelected = selectedFiles?.has(item.id) && item.type === "file";
      const isFolderSelected = selectedFolders?.has(item.id) && item.type === "folder";

      if (isFileSelected || isFolderSelected) {
        // Drag all selected items
        const selectedFileItems: DragItem[] =
          files
            ?.filter((f) => selectedFiles?.has(f.id))
            .map((f) => ({ id: f.id, type: "file" as const, name: f.name })) || [];
        const selectedFolderItems: DragItem[] =
          folders
            ?.filter((f) => selectedFolders?.has(f.id))
            .map((f) => ({ id: f.id, type: "folder" as const, name: f.name })) || [];

        itemsToDrag = [...selectedFolderItems, ...selectedFileItems];
      }

      e.dataTransfer.setData("text/plain", JSON.stringify(itemsToDrag));
      setDraggedItem(item);
      setDraggedItems(itemsToDrag);
      setIsDragging(true);

      // Create and set custom drag ghost (for single or multiple items)
      const ghost = createDragGhost(itemsToDrag);
      e.dataTransfer.setDragImage(ghost, 20, 20);

      // Clean up ghost after drag starts
      setTimeout(() => {
        document.body.removeChild(ghost);
      }, DRAG_GHOST_CLEANUP_DELAY_MS);
    },
    [selectedFiles, selectedFolders, files, folders, createDragGhost],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDraggedItems([]);
    setDragOverTarget(null);
    setIsDragging(false);
    dragCounter.current = 0;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, target: DropTarget) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(target);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear drag over target if we're leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, target: DropTarget) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const itemData = e.dataTransfer.getData("text/plain");
        const items: DragItem[] = JSON.parse(itemData);

        // Filter out invalid moves
        const validItems = items.filter((item) => {
          // Prevent dropping on itself
          if (item.id === target.id) {
            return false;
          }
          // Prevent dropping folder into itself
          if (item.type === "folder" && item.id === target.id) {
            return false;
          }
          return true;
        });

        if (validItems.length === 0) {
          toast.error(t("files.errors.cannotMoveHere"));
          return;
        }

        // Update UI immediately for all items (optimistic update)
        if (onImmediateUpdate) {
          validItems.forEach((item) => {
            onImmediateUpdate(item.id, item.type, target.id);
          });
        }

        // Move all items in parallel
        const movePromises = validItems.map((item) => {
          if (item.type === "file") {
            return moveFile(item.id, { folderId: target.id });
          } else if (item.type === "folder") {
            return moveFolder(item.id, { parentId: target.id });
          }
          return Promise.resolve();
        });

        await Promise.all(movePromises);

        // Show success message
        if (validItems.length === 1) {
          toast.success(
            validItems[0].type === "folder"
              ? t("files.drag.folderMoved", { name: validItems[0].name, target: target.name })
              : t("files.drag.fileMoved", { name: validItems[0].name, target: target.name }),
          );
        } else {
          toast.success(
            t("files.drag.itemsMoved", { count: validItems.length, target: target.name }),
          );
        }
      } catch (error) {
        logger.error("Error moving items", {
          err: error instanceof Error ? error.message : String(error),
        });
        toast.error(t("files.errors.moveItemsFailed"));
        // Refresh to restore state on error
        if (onRefresh) {
          await onRefresh();
        }
      } finally {
        handleDragEnd();
      }
    },
    [onImmediateUpdate, t, onRefresh, handleDragEnd],
  );

  return {
    draggedItem,
    draggedItems,
    dragOverTarget,
    isDragging,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
