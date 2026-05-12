import { LayoutGrid, Table } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FilesGrid } from "@/components/tables/files-grid";
import { FilesTable } from "@/components/tables/files-table";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { Button } from "@/components/ui/button";

interface FilesViewProps {
  files: FileItem[];
  folders?: FolderItem[];
  onPreview?: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onUpdateName: (fileId: string, newName: string) => void;
  onUpdateDescription: (fileId: string, newDescription: string) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onShare: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  onBulkDelete?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkShare?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkDownload?: (files: FileItem[], folders: FolderItem[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
}

export type ViewMode = "table" | "grid";

export function FilesView({
  files,
  onPreview,
  onRename,
  onUpdateName,
  onUpdateDescription,
  onDownload,
  onShare,
  onDelete,
  onBulkDelete,
  onBulkShare,
  onBulkDownload,
  setClearSelectionCallback,
}: FilesViewProps) {
  const t = useTranslations();
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const baseProps = {
    files,
    folders: [],
    onPreview,
    onRename,
    onDownload,
    onShare,
    onDelete,
    onBulkDelete: (files: FileItem[], folders: FolderItem[]) => onBulkDelete?.(files, folders),
    onBulkShare: (files: FileItem[], folders: FolderItem[]) => onBulkShare?.(files, folders),
    onBulkDownload: (files: FileItem[], folders: FolderItem[]) => onBulkDownload?.(files, folders),
    setClearSelectionCallback,
  };

  const tableProps = {
    ...baseProps,
    onUpdateName,
    onUpdateDescription,
  };

  const gridProps = baseProps;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {t("files.viewMode.label")}:
          </span>
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("table")}
            >
              <Table className="h-4 w-4" />
              {t("files.viewMode.table")}
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
              {t("files.viewMode.grid")}
            </Button>
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          {t("files.totalFiles", { count: files.length })}
        </div>
      </div>

      {viewMode === "table" ? <FilesTable {...tableProps} /> : <FilesGrid {...gridProps} />}
    </div>
  );
}
