"use client";

import { useQuickShare } from "../../hooks/use-quick-share";
import { QuickShareConfirmation } from "./quick-share-confirmation";
import { QuickShareDropzone } from "./quick-share-dropzone";
import { QuickShareUpload } from "./quick-share-upload";

interface QuickShareProps {
  onShareCreated?: () => void;
  smtpEnabled?: string;
}

export function QuickShare({ onShareCreated, smtpEnabled }: QuickShareProps) {
  const {
    state,
    settings,
    shareLink,
    fileUploads,
    isSubmitting,
    pendingShare,
    smtpEnabled: resolvedSmtp,
    handleFilesAdded,
    updateSettings,
    handleShare,
    removeFile,
    retryUpload,
    reset,
    isValidEmail,
  } = useQuickShare({ onShareCreated, smtpEnabled });

  switch (state) {
    case "dropzone":
      return <QuickShareDropzone onFilesAdded={handleFilesAdded} />;

    case "uploading":
      return (
        <QuickShareUpload
          fileUploads={fileUploads}
          settings={settings}
          isSubmitting={isSubmitting}
          pendingShare={pendingShare}
          smtpEnabled={resolvedSmtp}
          onFilesAdded={handleFilesAdded}
          onUpdateSettings={updateSettings}
          onRemoveFile={removeFile}
          onRetryUpload={retryUpload}
          onShare={handleShare}
          isValidEmail={isValidEmail}
        />
      );

    case "confirmation":
      return (
        <QuickShareConfirmation
          shareLink={shareLink}
          settings={settings}
          fileCount={fileUploads.filter((u) => u.status === "success").length}
          onReset={reset}
        />
      );
  }
}
