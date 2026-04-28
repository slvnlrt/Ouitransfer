import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import type { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";

export type { FileItem, FolderItem };

export interface HeaderProps {
  onUpload: () => void;
  onCreateFolder?: () => void;
}

export interface FileListProps {
  files: FileItem[];
  filteredFiles: FileItem[];
  folders?: FolderItem[];
  filteredFolders?: FolderItem[];
  fileManager: EnhancedFileManagerHook;
  searchQuery: string;
  onSearch: (query: string) => void;
  onUpload: () => void;
}

export interface SearchBarProps {
  searchQuery: string;
  onSearch: (query: string) => void;
  totalFiles: number;
  totalFolders?: number;
  filteredCount: number;
  filteredFolders?: number;
}

export interface FilesModalsProps {
  fileManager: EnhancedFileManagerHook;
  modals: {
    isUploadModalOpen: boolean;
    onCloseUploadModal: () => void;
  };
  onSuccess: () => Promise<void>;
}
