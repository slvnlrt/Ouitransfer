import { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";

export type { FileItem, FolderItem };

export interface HeaderProps {
  onUpload: () => void;
  onCreateFolder?: () => void;
}

// Files and folders come from the use-file-browser hook which returns API types
export interface FileListProps {
  // biome-ignore lint/suspicious/noExplicitAny: hook return types are not strongly typed
  files: any[];
  // biome-ignore lint/suspicious/noExplicitAny: hook return types are not strongly typed
  filteredFiles: any[];
  // biome-ignore lint/suspicious/noExplicitAny: hook return types are not strongly typed
  folders?: any[];
  // biome-ignore lint/suspicious/noExplicitAny: hook return types are not strongly typed
  filteredFolders?: any[];
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
