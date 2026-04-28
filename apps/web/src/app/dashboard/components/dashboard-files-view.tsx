import { FilesTable } from "@/components/tables/files-table";
import type { FileItem } from "@/components/tables/files-table-types";

interface DashboardFilesViewProps {
  files: FileItem[];
  onPreview: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onUpdateName: (fileId: string, newName: string) => void;
  onUpdateDescription: (fileId: string, newDescription: string) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onShare: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  onBulkDelete?: (files: FileItem[]) => void;
  onBulkShare?: (files: FileItem[]) => void;
  onBulkDownload?: (files: FileItem[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
}

export function DashboardFilesView({
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
}: DashboardFilesViewProps) {
  return (
    <FilesTable
      files={files}
      folders={[]}
      onPreview={onPreview}
      onRename={onRename}
      onUpdateName={onUpdateName}
      onUpdateDescription={onUpdateDescription}
      onDownload={onDownload}
      onShare={onShare}
      onDelete={onDelete}
      onBulkDelete={onBulkDelete ? (files) => onBulkDelete(files) : undefined}
      onBulkShare={onBulkShare ? (files) => onBulkShare(files) : undefined}
      onBulkDownload={onBulkDownload ? (files) => onBulkDownload(files) : undefined}
      setClearSelectionCallback={setClearSelectionCallback}
    />
  );
}
