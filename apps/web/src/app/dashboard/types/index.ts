import type { FileItem } from "@/components/tables/files-table-types";
import type { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";
import type { ShareManagerHook } from "@/hooks/use-share-manager";
import type { Share } from "@/http/endpoints/shares/types";

export interface RecentFilesProps {
  files: FileItem[];
  fileManager: EnhancedFileManagerHook;
  isUploadModalOpen: boolean;
  onOpenUploadModal: () => void;
}

export interface RecentSharesProps {
  shares: Share[];
  shareManager: ShareManagerHook;
  isCreateModalOpen: boolean;
  onOpenCreateModal: () => void;
  onCopyLink: (share: Share) => void;
}

export interface DashboardModalsProps {
  modals: {
    isUploadModalOpen: boolean;
    isCreateModalOpen: boolean;
    onCloseUploadModal: () => void;
    onCloseCreateModal: () => void;
  };
  fileManager: EnhancedFileManagerHook;
  shareManager: ShareManagerHook;
  onSuccess: () => Promise<void>;
  smtpEnabled?: string;
}
