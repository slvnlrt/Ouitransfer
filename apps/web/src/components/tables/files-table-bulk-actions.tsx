import {
  IconArrowsMove,
  IconChevronDown,
  IconDownload,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileItem, FolderItem } from "./files-table-types";

interface FilesTableBulkActionsProps {
  selectedCount: number;
  isShareMode: boolean;
  onBulkDelete?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkShare?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkDownload?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkMove?: (files: FileItem[], folders: FolderItem[]) => void;
  onAction: (action: "delete" | "share" | "download" | "move") => void;
  onClearSelection: () => void;
}

export function FilesTableBulkActions({
  selectedCount,
  isShareMode,
  onBulkDelete,
  onBulkShare,
  onBulkDownload,
  onBulkMove,
  onAction,
  onClearSelection,
}: FilesTableBulkActionsProps) {
  const t = useTranslations();

  return (
    <div className="flex items-center justify-between p-4 bg-muted/30 border rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {t("filesTable.bulkActions.selected", { count: selectedCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isShareMode ? (
          onBulkDownload && (
            <Button variant="default" size="sm" className="gap-2" onClick={() => onAction("download")}>
              <IconDownload className="h-4 w-4" />
              {t("filesTable.bulkActions.download")}
            </Button>
          )
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" className="gap-2">
                {t("filesTable.bulkActions.actions")}
                <IconChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              {onBulkMove && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onAction("move")}>
                  <IconArrowsMove className="h-4 w-4" />
                  {t("common.move")}
                </DropdownMenuItem>
              )}
              {onBulkDownload && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onAction("download")}>
                  <IconDownload className="h-4 w-4" />
                  {t("filesTable.bulkActions.download")}
                </DropdownMenuItem>
              )}
              {onBulkShare && (
                <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onAction("share")}>
                  <IconShare className="h-4 w-4" />
                  {t("filesTable.bulkActions.share")}
                </DropdownMenuItem>
              )}
              {onBulkDelete && (
                <DropdownMenuItem
                  onClick={() => onAction("delete")}
                  className="cursor-pointer py-2 text-destructive focus:text-destructive"
                >
                  <IconTrash className="h-4 w-4" />
                  {t("filesTable.bulkActions.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="outline" size="sm" onClick={onClearSelection}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
