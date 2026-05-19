"use client";

import { ChevronDown, ClipboardCopy, Download, File, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  copyReverseShareFileToUserFiles,
  deleteReverseShareFile,
  downloadReverseShareFile,
  updateReverseShareFile,
} from "@/http/endpoints/reverse-shares";
import type { ReverseShareFile } from "@/http/endpoints/reverse-shares/types";
import { logger } from "@/lib/logger";
import { getFileIcon } from "@/utils/file-icons";
import { truncateFileName } from "@/utils/file-utils";
import type { ReverseShare } from "../hooks/use-reverse-shares";
import { FileRow, type HoverState, useFileEdit } from "./received-files-file-row";
import { ReverseShareFilePreviewModal } from "./reverse-share-file-preview-modal";

const formatFileSize = (sizeString: string) => {
  const sizeInBytes = parseInt(sizeString, 10);
  if (sizeInBytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(sizeInBytes) / Math.log(k));
  return `${parseFloat((sizeInBytes / k ** i).toFixed(1))} ${units[i]}`;
};

interface ReceivedFilesModalProps {
  reverseShare: ReverseShare | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => Promise<void>;
  refreshReverseShare?: (id: string) => Promise<void>;
}

export function ReceivedFilesModal({
  reverseShare,
  isOpen,
  onClose,
  onRefresh,
  refreshReverseShare,
}: ReceivedFilesModalProps) {
  const t = useTranslations();
  const [previewFile, setPreviewFile] = useState<ReverseShareFile | null>(null);
  const [hoveredFile, setHoveredFile] = useState<HoverState | null>(null);
  const [copyingFile, setCopyingFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkCopying, setBulkCopying] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filesToDeleteBulk, setFilesToDeleteBulk] = useState<ReverseShareFile[]>([]);

  const { editingFile, editValue, setEditValue, inputRef, startEdit, cancelEdit } = useFileEdit();

  useEffect(() => {
    setSelectedFiles(new Set());
  }, [reverseShare?.files]);

  const getTotalSize = () => {
    if (!reverseShare?.files) return "0 B";
    const totalBytes = reverseShare.files.reduce((acc, file) => acc + parseInt(file.size, 10), 0);
    return formatFileSize(totalBytes.toString());
  };

  const handleDownload = async (file: ReverseShareFile) => {
    try {
      const loadingToast = toast.loading(t("reverseShares.modals.receivedFiles.downloading"));
      const response = await downloadReverseShareFile(file.id);

      const link = document.createElement("a");
      link.href = response.data.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.dismiss(loadingToast);
      toast.success(t("reverseShares.modals.receivedFiles.downloadSuccess"));
    } catch (error) {
      logger.error("Download error:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("reverseShares.modals.receivedFiles.downloadError"));
    }
  };

  const handlePreview = (file: ReverseShareFile) => {
    setPreviewFile(file);
  };

  const saveEdit = async () => {
    if (!editingFile) return;

    try {
      const updateData: { name?: string; description?: string | null } = {};

      if (editingFile.field === "name") {
        updateData.name = editValue.trim();
      } else if (editingFile.field === "description") {
        updateData.description = editValue.trim() || null;
      }

      await updateReverseShareFile(editingFile.fileId, updateData);

      if (refreshReverseShare && reverseShare) {
        await refreshReverseShare(reverseShare.id);
      } else if (onRefresh) {
        await onRefresh();
      }

      toast.success(t("reverseShares.modals.receivedFiles.editSuccess"));
    } catch (error) {
      logger.error("Error updating file:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("reverseShares.modals.receivedFiles.editError"));
    } finally {
      cancelEdit();
    }
  };

  const handleDeleteFile = async (file: ReverseShareFile) => {
    try {
      await deleteReverseShareFile(file.id);

      if (refreshReverseShare && reverseShare) {
        await refreshReverseShare(reverseShare.id);
      } else if (onRefresh) {
        await onRefresh();
      }

      toast.success(t("reverseShares.modals.receivedFiles.deleteSuccess"));
    } catch (error) {
      logger.error("Error deleting file:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("reverseShares.modals.receivedFiles.deleteError"));
    }
  };

  const handleCopyFile = async (file: ReverseShareFile) => {
    try {
      setCopyingFile(file.id);
      await copyReverseShareFileToUserFiles(file.id);
      toast.success(t("reverseShares.modals.receivedFiles.copySuccess"));
    } catch (error: unknown) {
      logger.error("Error copying file:", {
        err: error instanceof Error ? error.message : String(error),
      });

      let errorMessage = t("reverseShares.modals.receivedFiles.copyError");

      const err = error as {
        message?: string;
        code?: string;
        response?: { data?: { error?: string } };
        name?: string;
      } | null;
      if (err?.message?.includes("timeout") || err?.code === "UND_ERR_SOCKET") {
        errorMessage = t("reverseShares.modals.receivedFiles.copyErrors.timeout");
      } else if (err?.response?.data?.error) {
        const serverError = err.response.data.error;
        if (
          serverError.includes("File size exceeds") ||
          serverError.includes("Insufficient storage")
        ) {
          errorMessage = serverError;
        } else if (serverError.includes("Copy operation failed")) {
          errorMessage = t("reverseShares.modals.receivedFiles.copyErrors.failed");
        }
      } else if (err?.name === "AbortError") {
        errorMessage = t("reverseShares.modals.receivedFiles.copyErrors.aborted");
      }
      toast.error(errorMessage);
    } finally {
      setCopyingFile(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  if (!reverseShare) return null;

  const files = reverseShare.files || [];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFiles(new Set(files.map((file) => file.id)));
    } else {
      setSelectedFiles(new Set());
    }
  };

  const handleSelectFile = (fileId: string, checked: boolean) => {
    const newSelected = new Set(selectedFiles);
    if (checked) {
      newSelected.add(fileId);
    } else {
      newSelected.delete(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const getSelectedFileObjects = () => {
    return files.filter((file) => selectedFiles.has(file.id));
  };

  const isAllSelected = files.length > 0 && selectedFiles.size === files.length;

  const handleBulkDownload = async () => {
    const selectedFileObjects = getSelectedFileObjects();
    if (selectedFileObjects.length === 0) return;

    try {
      const loadingToast = toast.loading(t("shareManager.creatingZip"));

      try {
        for (const file of selectedFileObjects) {
          const response = await downloadReverseShareFile(file.id);
          const link = document.createElement("a");
          link.href = response.data.url;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

        toast.dismiss(loadingToast);
        toast.success(t("shareManager.zipDownloadSuccess"));
        setSelectedFiles(new Set());
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(t("shareManager.zipDownloadError"));
        throw error;
      }
    } catch (error) {
      logger.error("Error creating ZIP:", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleBulkCopyToMyFiles = async () => {
    const selectedFileObjects = getSelectedFileObjects();
    if (selectedFileObjects.length === 0) return;

    toast.promise(
      (async () => {
        setBulkCopying(true);
        try {
          const copyPromises = selectedFileObjects.map(async (file) => {
            try {
              await copyReverseShareFileToUserFiles(file.id);
            } catch (error: unknown) {
              logger.error(`Error copying file ${file.name}:`, {
                err: error instanceof Error ? error.message : String(error),
              });
              const err = error as {
                response?: { data?: { error?: string } };
                message?: string;
              } | null;
              throw new Error(
                `Failed to copy ${file.name}: ${err?.response?.data?.error ?? err?.message ?? String(error)}`,
              );
            }
          });

          await Promise.all(copyPromises);
          setSelectedFiles(new Set());
        } finally {
          setBulkCopying(false);
        }
      })(),
      {
        loading: t("reverseShares.modals.receivedFiles.bulkCopyProgress", {
          count: selectedFileObjects.length,
        }),
        success: t("reverseShares.modals.receivedFiles.bulkCopySuccess", {
          count: selectedFileObjects.length,
        }),
        error: (error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("File size exceeds") || msg.includes("Insufficient storage")) {
            return msg;
          } else {
            return t("reverseShares.modals.receivedFiles.copyError");
          }
        },
      },
    );
  };

  const handleBulkDelete = () => {
    const selectedFileObjects = getSelectedFileObjects();
    if (selectedFileObjects.length === 0) return;

    setFilesToDeleteBulk(selectedFileObjects);
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    if (filesToDeleteBulk.length === 0) return;

    setShowDeleteConfirm(false);

    toast.promise(
      (async () => {
        setBulkDeleting(true);
        try {
          const deletePromises = filesToDeleteBulk.map(async (file) => {
            try {
              await deleteReverseShareFile(file.id);
            } catch (error) {
              logger.error(`Error deleting file ${file.name}:`, {
                err: error instanceof Error ? error.message : String(error),
              });
              throw new Error(`Failed to delete ${file.name}`);
            }
          });

          await Promise.all(deletePromises);

          setSelectedFiles(new Set());
          setFilesToDeleteBulk([]);
          if (onRefresh) {
            await onRefresh();
          }
          if (refreshReverseShare) {
            await refreshReverseShare(reverseShare.id);
          }
        } finally {
          setBulkDeleting(false);
        }
      })(),
      {
        loading: t("reverseShares.modals.receivedFiles.bulkDeleteProgress", {
          count: filesToDeleteBulk.length,
        }),
        success: t("reverseShares.modals.receivedFiles.bulkDeleteSuccess", {
          count: filesToDeleteBulk.length,
        }),
        error: "Error deleting selected files",
      },
    );
  };

  const showBulkActions = selectedFiles.size > 0;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <File className="size-5" />
              {t("reverseShares.modals.receivedFiles.title")}
            </DialogTitle>
            <DialogDescription>
              {t("reverseShares.modals.receivedFiles.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 min-h-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Badge variant="secondary" className="text-sm">
                  {t("reverseShares.modals.receivedFiles.fileCount", { count: files.length })}
                </Badge>
                <Badge variant="outline" className="text-sm">
                  {t("reverseShares.modals.receivedFiles.totalSize", { size: getTotalSize() })}
                </Badge>
              </div>
            </div>

            <Separator />

            {showBulkActions && (
              <div className="flex items-center justify-between p-4 bg-muted/30 border rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {t("reverseShares.modals.receivedFiles.bulkActions.selected", {
                      count: selectedFiles.size,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="default" size="sm" className="gap-2">
                        {t("reverseShares.modals.receivedFiles.bulkActions.actions")}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                      <DropdownMenuItem
                        className="cursor-pointer py-2"
                        onClick={handleBulkDownload}
                      >
                        <Download className="h-4 w-4" />
                        {t("reverseShares.modals.receivedFiles.bulkActions.download")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer py-2"
                        onClick={handleBulkCopyToMyFiles}
                        disabled={bulkCopying}
                      >
                        {bulkCopying ? (
                          <Spinner size="sm" />
                        ) : (
                          <ClipboardCopy className="h-4 w-4" />
                        )}
                        {t("reverseShares.modals.receivedFiles.bulkActions.copyToMyFiles")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer py-2 text-destructive focus:text-destructive"
                        onClick={handleBulkDelete}
                        disabled={bulkDeleting}
                      >
                        {bulkDeleting ? (
                          <Spinner size="sm" className="border-red-600 border-t-transparent" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        {t("reverseShares.modals.receivedFiles.bulkActions.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="outline" size="sm" onClick={() => setSelectedFiles(new Set())}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}

            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                  <File className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-lg font-medium">
                    {t("reverseShares.modals.receivedFiles.noFiles")}
                  </h3>
                  <p className="text-muted-foreground max-w-md">
                    {t("reverseShares.modals.receivedFiles.noFilesDescription")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[450px] w-full overflow-y-auto rounded-lg border bg-background shadow-sm">
                <div className="p-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={handleSelectAll}
                            aria-label={t("reverseShares.modals.receivedFiles.selectAll")}
                          />
                        </TableHead>
                        <TableHead>
                          {t("reverseShares.modals.receivedFiles.columns.file")}
                        </TableHead>
                        <TableHead>
                          {t("reverseShares.modals.receivedFiles.columns.size")}
                        </TableHead>
                        <TableHead>
                          {t("reverseShares.modals.receivedFiles.columns.sender")}
                        </TableHead>
                        <TableHead>
                          {t("reverseShares.modals.receivedFiles.columns.date")}
                        </TableHead>
                        <TableHead className="text-end">
                          {t("reverseShares.modals.receivedFiles.columns.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {files.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          editingFile={editingFile}
                          editValue={editValue}
                          inputRef={inputRef}
                          hoveredFile={hoveredFile}
                          copyingFile={copyingFile}
                          isSelected={selectedFiles.has(file.id)}
                          onStartEdit={startEdit}
                          onSaveEdit={saveEdit}
                          onCancelEdit={cancelEdit}
                          onEditValueChange={setEditValue}
                          onKeyDown={handleKeyDown}
                          onSetHoveredFile={setHoveredFile}
                          onPreview={handlePreview}
                          onDownload={handleDownload}
                          onDelete={handleDeleteFile}
                          onCopy={handleCopyFile}
                          onSelectFile={handleSelectFile}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("reverseShares.modals.receivedFiles.bulkDeleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("reverseShares.modals.receivedFiles.bulkDeleteConfirmMessage", {
                count: filesToDeleteBulk.length,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto border rounded-lg p-2">
            <div className="space-y-1">
              {filesToDeleteBulk.map((file) => {
                const { icon: FileIcon, color } = getFileIcon(file.name);
                const displayName = truncateFileName(file.name);
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 p-2 bg-muted/20 rounded text-sm min-w-0"
                  >
                    <FileIcon className={`h-4 w-4 ${color} flex-shrink-0`} />
                    <span className="flex-1 break-all" title={file.name}>
                      {displayName}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? (
                <Spinner size="sm" className="border-white border-t-transparent me-2" />
              ) : null}
              {t("reverseShares.modals.receivedFiles.bulkDeleteConfirmButton", {
                count: filesToDeleteBulk.length,
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewFile && (
        <ReverseShareFilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          file={previewFile}
        />
      )}
    </>
  );
}
