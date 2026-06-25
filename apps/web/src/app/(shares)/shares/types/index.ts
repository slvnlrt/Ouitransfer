import type { EnhancedFileManagerHook } from "@/hooks/use-enhanced-file-manager";
import type { ShareManagerHook } from "@/hooks/use-share-manager";
import type { Share } from "@/http/endpoints/shares/types";

export type { Share };

export interface SharesSearchProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCreateShare: () => void;
  totalShares: number;
  filteredCount: number;
}

export interface SharesTableContainerProps {
  shares: Share[];
  onCopyLink: (share: Share) => void;
  onCreateShare: () => void;
  shareManager: ShareManagerHook;
}

export interface SharesModalsProps {
  isCreateModalOpen: boolean;
  onCloseCreateModal: () => void;
  shareToViewDetails: Share | null;
  shareToGenerateLink: Share | null;
  shareManager: ShareManagerHook;
  fileManager: EnhancedFileManagerHook;
  onSuccess: () => void;
  onCloseViewDetails: () => void;
  onCloseGenerateLink: () => void;
  smtpEnabled?: string;
}
