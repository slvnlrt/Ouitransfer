"use client";

import { CloudUpload, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { StatusIcon } from "@/components/ui/status-icon";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useStorageCheck } from "@/hooks/use-storage-check";
import { logger } from "@/lib/logger";
import { formatFileSize } from "@/utils/format-file-size";

interface UploadFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  currentFolderId?: string;
}

interface ConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  uploadsInProgress: number;
}

function ConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  uploadsInProgress,
}: ConfirmationModalProps) {
  const t = useTranslations();

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-amber-500" />
            {t("uploadFile.confirmCancel.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-2">
            {uploadsInProgress > 1
              ? t("uploadFile.confirmCancel.messageMultiple", { count: uploadsInProgress })
              : t("uploadFile.confirmCancel.messageSingle")}
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("uploadFile.confirmCancel.warning")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("uploadFile.confirmCancel.continue")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("uploadFile.confirmCancel.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UploadFileModal({
  isOpen,
  onClose,
  onSuccess,
  currentFolderId,
}: UploadFileModalProps) {
  const t = useTranslations();
  const [isDragOver, setIsDragOver] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const hasShownSuccessToastRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { checkStorageSpace } = useStorageCheck();

  const {
    addFiles,
    startUpload,
    cancelUpload,
    retryUpload,
    removeFile,
    clearAll,
    fileUploads,
    isUploading,
  } = useFileUpload({ currentFolderId });

  // Monitor upload completion and call onSuccess when all done
  useEffect(() => {
    // Only process if we have uploads and they're not currently uploading
    if (fileUploads.length === 0 || isUploading || hasShownSuccessToastRef.current) {
      return;
    }

    const successCount = fileUploads.filter((u) => u.status === "success").length;
    const errorCount = fileUploads.filter((u) => u.status === "error").length;
    const pendingCount = fileUploads.filter(
      (u) => u.status === "pending" || u.status === "uploading",
    ).length;

    // All uploads are done (no pending/uploading)
    if (pendingCount === 0 && (successCount > 0 || errorCount > 0)) {
      hasShownSuccessToastRef.current = true;

      if (successCount > 0) {
        if (errorCount > 0) {
          toast.error(t("uploadFile.partialSuccess", { success: successCount, error: errorCount }));
        } else {
          toast.success(t("uploadFile.allSuccess", { count: successCount }));
        }

        // Call parent's onSuccess to refresh the file list
        // Add delay to ensure backend has processed everything
        setTimeout(() => {
          onSuccess?.();
        }, 300);
      }
    }
  }, [fileUploads, isUploading, onSuccess, t]);

  // Reset toast flag and clear uploads when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasShownSuccessToastRef.current = false;
      clearAll();
    }
  }, [isOpen, clearAll]);

  // Handle file input change
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(Array.from(event.target.files));
      hasShownSuccessToastRef.current = false; // Reset when adding new files
      event.target.value = ""; // Reset input
    }
  };

  // Handle drag and drop
  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    event.stopPropagation();

    const files = event.dataTransfer.files;
    if (files.length > 0) {
      addFiles(Array.from(files));
      hasShownSuccessToastRef.current = false; // Reset when adding new files
    }
  };

  const handleConfirmClose = () => {
    // Cancel all uploads
    fileUploads.forEach((upload) => {
      if (upload.status === "uploading") {
        cancelUpload(upload.id);
      }
      // Revoke preview URLs
      if (upload.previewUrl) {
        URL.revokeObjectURL(upload.previewUrl);
      }
    });

    setShowConfirmation(false);
    onClose();
  };

  // Prevent closing while uploading
  const handleClose = () => {
    if (isUploading) {
      setShowConfirmation(true);
    } else {
      handleConfirmClose();
    }
  };

  const handleContinueUploads = () => {
    setShowConfirmation(false);
  };

  const allUploadsComplete =
    fileUploads.length > 0 &&
    fileUploads.every(
      (u) => u.status === "success" || u.status === "error" || u.status === "cancelled",
    );

  const hasPendingUploads = fileUploads.some((u) => u.status === "pending");

  const handleStartUpload = async () => {
    const totalBytes = fileUploads
      .filter((u) => u.status === "pending")
      .reduce((sum, u) => sum + (u.file.size ?? 0), 0);

    try {
      setIsCheckingStorage(true);
      const { allowed } = await checkStorageSpace(totalBytes);
      if (!allowed) return;
    } catch (error) {
      logger.error("Storage check failed, proceeding with upload", {
        err: error instanceof Error ? error.message : String(error),
      });
      // If the check itself fails (network error etc.), allow the upload to proceed.
      // The server will enforce the limit on the actual upload request.
    } finally {
      setIsCheckingStorage(false);
    }

    startUpload();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudUpload className="h-5 w-5" />
              {t("uploadFile.multipleTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              multiple
              onChange={handleFileInputChange}
            />

            <button
              type="button"
              className={`w-full border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
                isDragOver
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <CloudUpload className="size-8 text-muted-foreground" />
                <p className="text-foreground text-center">{t("uploadFile.selectMultipleFiles")}</p>
                <p className="text-sm text-muted-foreground">{t("uploadFile.dragAndDrop")}</p>
              </div>
            </button>

            {fileUploads.length > 0 && (
              <div className="flex-1 overflow-y-auto space-y-2 max-h-96">
                {fileUploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-card"
                  >
                    <div className="flex-shrink-0">
                      {upload.previewUrl ? (
                        <img
                          src={upload.previewUrl}
                          alt={upload.file.name}
                          className="w-10 h-10 rounded object-cover"
                        />
                      ) : (
                        <FileTypeIcon fileName={upload.file.name} className="size-6" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate text-foreground">
                          {upload.file.name}
                        </p>
                        <StatusIcon status={upload.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(upload.file.size)}
                      </p>

                      {upload.status === "uploading" && (
                        <div className="mt-1">
                          <Progress value={upload.progress} className="h-1" />
                          <p className="text-xs text-muted-foreground mt-1">{upload.progress}%</p>
                        </div>
                      )}

                      {upload.status === "error" && upload.error && (
                        <p className="text-xs text-destructive mt-1">{upload.error}</p>
                      )}
                    </div>

                    <div className="flex-shrink-0">
                      {upload.status === "uploading" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelUpload(upload.id)}
                          className="h-8 w-8 p-0"
                        >
                          <X className="size-3.5" />
                        </Button>
                      ) : upload.status === "success" ? null : upload.status === "error" ? (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => retryUpload(upload.id)}
                            className="h-8 w-8 p-0"
                            title={t("uploadFile.retry")}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(upload.id)}
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(upload.id)}
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              {allUploadsComplete ? t("common.close") : t("common.cancel")}
            </Button>
            {!allUploadsComplete && (
              <Button
                variant="default"
                disabled={fileUploads.length === 0 || isUploading || isCheckingStorage}
                onClick={handleStartUpload}
              >
                {isUploading || isCheckingStorage ? (
                  <Spinner size="sm" />
                ) : (
                  <CloudUpload className="h-4 w-4" />
                )}
                {hasPendingUploads ? t("uploadFile.startUploads") : t("uploadFile.upload")}
              </Button>
            )}
            {allUploadsComplete && (
              <Button variant="default" onClick={handleConfirmClose}>
                {t("uploadFile.finish")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={showConfirmation}
        onConfirm={handleConfirmClose}
        onCancel={handleContinueUploads}
        uploadsInProgress={fileUploads.filter((u) => u.status === "uploading").length}
      />
    </>
  );
}
