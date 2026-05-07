import { IconLayoutGrid, IconSearch, IconTable } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FilesGridSkeleton, FilesTableSkeleton } from "@/components/skeletons";
import { FilesGrid } from "@/components/tables/files-grid";
import { FilesTable } from "@/components/tables/files-table";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FilesViewManagerProps {
  files: FileItem[];
  folders?: FolderItem[];
  searchQuery: string;
  onSearch: (query: string) => void;
  onNavigateToFolder?: (folderId: string) => void;
  onDownload: (objectName: string, fileName: string) => void;
  breadcrumbs?: React.ReactNode;
  isLoading?: boolean;
  emptyStateComponent?: React.ComponentType;
  isShareMode?: boolean;
  onCreateFolder?: () => void;
  onUpload?: () => void;
  onDeleteFolder?: (folder: FolderItem) => void;
  onImmediateUpdate?: (
    itemId: string,
    itemType: "file" | "folder",
    newParentId: string | null,
  ) => void;
  onRefresh?: () => Promise<void>;
  onRenameFolder?: (folder: FolderItem) => void;
  onMoveFolder?: (folder: FolderItem) => void;
  onMoveFile?: (file: FileItem) => void;
  onShareFolder?: (folder: FolderItem) => void;
  onDownloadFolder?: (folderId: string, folderName: string) => Promise<void>;
  onPreview?: (file: FileItem) => void;
  onRename?: (file: FileItem) => void;
  onUpdateName?: (fileId: string, newName: string) => void;
  onUpdateDescription?: (fileId: string, newDescription: string) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
  onBulkDelete?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkShare?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkDownload?: (files: FileItem[], folders: FolderItem[]) => void;
  onBulkMove?: (files: FileItem[], folders: FolderItem[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
  onUpdateFolderName?: (folderId: string, newName: string) => void;
  onUpdateFolderDescription?: (folderId: string, newDescription: string) => void;
}

export type ViewMode = "table" | "grid";

const VIEW_MODE_KEY = "files-view-mode";

export function FilesViewManager({
  files,
  folders,
  searchQuery,
  onSearch,
  onNavigateToFolder,
  onDownload,
  breadcrumbs,
  isLoading = false,
  emptyStateComponent: EmptyStateComponent,
  isShareMode = false,
  onCreateFolder,
  onUpload,
  onDeleteFolder,
  onRenameFolder,
  onMoveFolder,
  onImmediateUpdate,
  onRefresh,
  onMoveFile,
  onShareFolder,
  onDownloadFolder,
  onPreview,
  onRename,
  onUpdateName,
  onUpdateDescription,
  onShare,
  onDelete,
  onBulkDelete,
  onBulkShare,
  onBulkDownload,
  onBulkMove,
  setClearSelectionCallback,
  onUpdateFolderName,
  onUpdateFolderDescription,
}: FilesViewManagerProps) {
  const t = useTranslations();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || "table";
    }
    return "table";
  });

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const hasContent = (folders?.length || 0) > 0 || files.length > 0;
  const showEmptyState = !hasContent && !searchQuery && !isLoading;

  const isFilesMode = !isShareMode && !!(onDeleteFolder || onRenameFolder || onShare || onDelete);

  const baseProps = {
    files,
    folders: folders || [],
    onNavigateToFolder,
    onCreateFolder: isShareMode ? undefined : onCreateFolder,
    onUpload: isShareMode ? undefined : onUpload,
    onDeleteFolder: isShareMode ? undefined : onDeleteFolder,
    onRenameFolder: isShareMode ? undefined : onRenameFolder,
    onMoveFolder: isShareMode ? undefined : onMoveFolder,
    onMoveFile: isShareMode ? undefined : onMoveFile,
    onShareFolder: isShareMode ? undefined : onShareFolder,
    onDownloadFolder,
    onPreview,
    onImmediateUpdate,
    onRefresh,
    onRename: isShareMode ? undefined : onRename,
    onDownload,
    onShare: isShareMode ? undefined : onShare,
    onDelete: isShareMode ? undefined : onDelete,
    onBulkDelete: isShareMode ? undefined : onBulkDelete,
    onBulkShare: isShareMode ? undefined : onBulkShare,
    onBulkDownload,
    onBulkMove: isShareMode ? undefined : onBulkMove,
    setClearSelectionCallback,
    onUpdateFolderName: isShareMode ? undefined : onUpdateFolderName,
    onUpdateFolderDescription: isShareMode ? undefined : onUpdateFolderDescription,
    showBulkActions: isFilesMode || (isShareMode && !!onBulkDownload),
    isShareMode,
  };

  const tableProps = {
    ...baseProps,
    onUpdateName: isShareMode ? undefined : onUpdateName,
    onUpdateDescription: isShareMode ? undefined : onUpdateDescription,
  };

  const gridProps = baseProps;

  return (
    <div className="space-y-4">
      {/* Breadcrumbs, Search and View Controls */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">{breadcrumbs}</div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <IconSearch className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("searchBar.placeholder")}
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              className="max-w-sm ps-10"
            />
          </div>

          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("table")}
            >
              <IconTable className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("grid")}
            >
              <IconLayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        viewMode === "table" ? (
          <FilesTableSkeleton rowCount={10} />
        ) : (
          <FilesGridSkeleton itemCount={12} />
        )
      ) : showEmptyState ? (
        EmptyStateComponent ? (
          <EmptyStateComponent />
        ) : (
          <div className="text-center py-6 flex flex-col items-center gap-2">
            <p className="text-muted-foreground">{t("files.empty.title")}</p>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {viewMode === "table" ? <FilesTable {...tableProps} /> : <FilesGrid {...gridProps} />}

          {/* No results message */}
          {searchQuery && !hasContent && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {t("searchBar.noResults", { query: searchQuery })}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
