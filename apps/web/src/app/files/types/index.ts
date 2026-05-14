import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import type { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";

export type { FileItem, FolderItem };

export interface HeaderProps {
  onUpload: () => void;
  onCreateFolder?: () => void;
}

export interface FilesModalsProps {
  fileManager: EnhancedFileManagerHook;
  modals: {
    isUploadModalOpen: boolean;
    onCloseUploadModal: () => void;
  };
  onSuccess: () => Promise<void>;
}
