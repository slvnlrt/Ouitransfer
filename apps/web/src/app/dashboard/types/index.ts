import type { FileItem } from "@/components/tables/files-table-types";
import type { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";
import type { ShareManagerHook } from "@/hooks/use-share-manager";
import type { CheckHealth200 } from "@/http/endpoints/app/types";
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

export interface StorageUsageProps {
  diskSpace: {
    diskSizeGB: number;
    diskUsedGB: number;
    diskAvailableGB: number;
    uploadAllowed: boolean;
  } | null;
  diskSpaceError?: string | null;
  onRetry?: () => void;
}

export interface SystemHealthProps {
  healthData: CheckHealth200 | null;
  healthError: boolean;
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
