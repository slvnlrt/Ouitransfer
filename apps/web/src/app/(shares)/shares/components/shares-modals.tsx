import { useTranslations } from "next-intl";
import { useState } from "react";

import { CreateShareModal } from "@/components/modals/create-share-modal";
import { DeleteConfirmationModal } from "@/components/modals/delete-confirmation-modal";
import { GenerateShareLinkModal } from "@/components/modals/generate-share-link-modal";
import { QrCodeModal } from "@/components/modals/qr-code-modal";
import { ShareActionsModals } from "@/components/modals/share-actions-modals";
import { ShareDetailsModal } from "@/components/modals/share-details-modal";
import { ShareExpirationModal } from "@/components/modals/share-expiration-modal";
import { ShareMultipleItemsModal } from "@/components/modals/share-multiple-items-modal";
import { ShareSecurityModal } from "@/components/modals/share-security-modal";
import { listFiles } from "@/http/endpoints";
import { listFolders } from "@/http/endpoints/folders";
import type { Share } from "@/http/endpoints/shares/types";
import type { SharesModalsProps } from "../types";

export function SharesModals({
  isCreateModalOpen,
  onCloseCreateModal,
  shareToViewDetails,
  shareToGenerateLink,
  shareManager,
  fileManager,
  onSuccess,
  onCloseViewDetails,
  onCloseGenerateLink,
}: SharesModalsProps) {
  const t = useTranslations();
  const [shareDetailsRefresh, setShareDetailsRefresh] = useState(0);

  const handleShareSuccess = () => {
    setShareDetailsRefresh((prev) => prev + 1);
    onSuccess();
  };

  const getShareLink = (share: Share | null) => {
    if (!share?.alias?.alias) return "";
    return `${window.location.origin}/s/${share.alias.alias}`;
  };

  return (
    <>
      <CreateShareModal
        isOpen={isCreateModalOpen}
        onClose={onCloseCreateModal}
        onSuccess={onSuccess}
        onShareCreated={(share) => shareManager.setShareToGenerateLink(share)}
        getAllFilesAndFolders={async () => {
          const [filesResponse, foldersResponse] = await Promise.all([listFiles(), listFolders()]);
          return {
            files: filesResponse.data.files || [],
            folders: foldersResponse.data.folders || [],
          };
        }}
      />

      <ShareActionsModals
        shareToDelete={shareManager.shareToDelete}
        shareToEdit={shareManager.shareToEdit}
        shareToManageFiles={shareManager.shareToManageFiles}
        shareToManageRecipients={shareManager.shareToManageRecipients}
        onCloseDelete={() => shareManager.setShareToDelete(null)}
        onCloseEdit={() => shareManager.setShareToEdit(null)}
        onCloseManageFiles={() => shareManager.setShareToManageFiles(null)}
        onCloseManageRecipients={() => shareManager.setShareToManageRecipients(null)}
        onDelete={shareManager.handleDelete}
        onEdit={shareManager.handleEdit}
        onSuccess={handleShareSuccess}
      />

      <QrCodeModal
        isOpen={!!shareManager.shareToViewQrCode}
        onClose={() => shareManager.setShareToViewQrCode(null)}
        shareLink={getShareLink(shareManager.shareToViewQrCode)}
        shareName={shareManager.shareToViewQrCode?.name || "Share"}
      />

      <DeleteConfirmationModal
        isOpen={!!shareManager.sharesToDelete}
        onClose={() => shareManager.setSharesToDelete(null)}
        onConfirm={shareManager.handleDeleteBulk}
        title={t("shareActions.bulkDeleteTitle")}
        description={t("shareActions.bulkDeleteConfirmation", {
          count: shareManager.sharesToDelete?.length || 0,
        })}
        files={shareManager.sharesToDelete?.map((share) => share.name ?? "") || []}
        itemType="shares"
      />

      <ShareDetailsModal
        shareId={shareToViewDetails?.id || null}
        onClose={onCloseViewDetails}
        onUpdateName={shareManager.handleUpdateName}
        onUpdateDescription={shareManager.handleUpdateDescription}
        onUpdateSecurity={
          shareToViewDetails
            ? async () => shareManager.handleUpdateSecurity(shareToViewDetails)
            : undefined
        }
        onUpdateExpiration={
          shareToViewDetails
            ? async () => shareManager.handleUpdateExpiration(shareToViewDetails)
            : undefined
        }
        onGenerateLink={shareManager.handleGenerateLink}
        onManageFiles={shareManager.setShareToManageFiles}
        refreshTrigger={shareDetailsRefresh}
        onSuccess={handleShareSuccess}
      />

      <GenerateShareLinkModal
        share={shareToGenerateLink}
        shareId={shareToGenerateLink?.id || null}
        onClose={onCloseGenerateLink}
        onGenerate={shareManager.handleGenerateLink}
        onSuccess={handleShareSuccess}
      />

      <ShareSecurityModal
        shareId={shareManager.shareToManageSecurity?.id || null}
        share={shareManager.shareToManageSecurity || null}
        onClose={() => shareManager.setShareToManageSecurity(null)}
        onSuccess={handleShareSuccess}
      />

      <ShareExpirationModal
        shareId={shareManager.shareToManageExpiration?.id || null}
        share={shareManager.shareToManageExpiration || null}
        onClose={() => shareManager.setShareToManageExpiration(null)}
        onSuccess={handleShareSuccess}
      />

      <ShareMultipleItemsModal
        files={fileManager.filesToShare}
        folders={null}
        isOpen={!!fileManager.filesToShare}
        onClose={() => fileManager.setFilesToShare(null)}
        onSuccess={() => {
          fileManager.handleShareBulkSuccess();
          onSuccess();
        }}
      />
    </>
  );
}
