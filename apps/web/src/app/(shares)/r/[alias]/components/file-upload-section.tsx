"use client";

import { Check, File, Mail, Upload, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { type FileUploadState, useUppyUpload } from "@/hooks/use-uppy-upload";
import {
  abortMultipartUploadByAlias,
  completeMultipartUploadByAlias,
  createMultipartUploadByAlias,
  getMultipartPartUrlByAlias,
  getPresignedUrlForUploadByAlias,
  listMultipartPartsByAlias,
  registerFileUploadByAlias,
} from "@/http/endpoints";
import { formatFileSize } from "@/utils/format-file-size";
import { UPLOAD_CONFIG } from "../constants";
import type { FileUploadSectionProps } from "../types";

export function FileUploadSection({
  reverseShare,
  password,
  alias,
  onUploadSuccess,
}: FileUploadSectionProps) {
  const [uploaderName, setUploaderName] = useState("");
  const [uploaderEmail, setUploaderEmail] = useState("");
  const [description, setDescription] = useState("");

  const t = useTranslations();

  const { addFiles, startUpload, removeFile, retryUpload, fileUploads, isUploading } =
    useUppyUpload({
      onValidate: async (file) => {
        // Client-side validations
        if (reverseShare.maxFileSize && file.size > reverseShare.maxFileSize) {
          const error = t("reverseShares.upload.errors.fileTooLarge", {
            maxSize: formatFileSize(reverseShare.maxFileSize),
          });
          toast.error(error);
          throw new Error(error);
        }

        if (reverseShare.allowedFileTypes) {
          const extension = file.name.split(".").pop()?.toLowerCase();
          const allowed = reverseShare.allowedFileTypes
            .split(",")
            .map((t) => t.trim().toLowerCase());
          if (extension && !allowed.includes(extension)) {
            const error = t("reverseShares.upload.errors.fileTypeNotAllowed", {
              allowedTypes: reverseShare.allowedFileTypes,
            });
            toast.error(error);
            throw new Error(error);
          }
        }

        if (reverseShare.maxFiles) {
          const totalFiles = fileUploads.length + 1 + reverseShare.currentFileCount;
          if (totalFiles > reverseShare.maxFiles) {
            const error = t("reverseShares.upload.errors.maxFilesExceeded", {
              maxFiles: reverseShare.maxFiles,
            });
            toast.error(error);
            throw new Error(error);
          }
        }
      },
      onBeforeUpload: async (file) => {
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        return `reverse-shares/${alias}/${timestamp}-${sanitizedFileName}`;
      },
      getPresignedUrl: async (_objectName, extension) => {
        const filename = _objectName.split("/").pop()?.replace(`.${extension}`, "") || _objectName;
        const response = await getPresignedUrlForUploadByAlias(
          alias,
          { filename, extension },
          password ? { password } : undefined,
        );
        return {
          url: response.data.url,
          method: "PUT",
          actualObjectName: response.data.objectName,
        };
      },
      onAfterUpload: async (_fileId, file, objectName) => {
        const fileExtension = file.name.split(".").pop() || "";

        const response = await registerFileUploadByAlias(
          alias,
          {
            name: file.name,
            description: description || undefined,
            extension: fileExtension,
            size: file.size,
            objectName,
            uploaderEmail: uploaderEmail || undefined,
            uploaderName: uploaderName || undefined,
          },
          password ? { password } : undefined,
        );

        return response.data.file.id;
      },
      onSuccess: () => {
        const successCount = fileUploads.filter((u) => u.status === "success").length;

        if (successCount > 0) {
          toast.success(
            t("reverseShares.upload.success.countMessage", {
              count: successCount,
            }),
          );

          onUploadSuccess?.();
        }
      },
      // Custom multipart functions for reverse share uploads (no auth required)
      customMultipartFunctions: {
        createMultipartUpload: async (filename: string, extension: string) => {
          const response = await createMultipartUploadByAlias(
            alias,
            { filename, extension },
            password ? { password } : undefined,
          );
          return response.data;
        },
        getMultipartPartUrl: async (uploadId: string, objectName: string, partNumber: string) => {
          const response = await getMultipartPartUrlByAlias(alias, {
            uploadId,
            objectName,
            partNumber,
            password,
          });
          return response.data;
        },
        completeMultipartUpload: async (
          uploadId: string,
          objectName: string,
          parts: Array<{ PartNumber: number; ETag: string }>,
        ) => {
          await completeMultipartUploadByAlias(
            alias,
            { uploadId, objectName, parts },
            password ? { password } : undefined,
          );
        },
        abortMultipartUpload: async (uploadId: string, objectName: string) => {
          await abortMultipartUploadByAlias(
            alias,
            { uploadId, objectName },
            password ? { password } : undefined,
          );
        },
        listParts: async (uploadId: string, objectName: string) => {
          const response = await listMultipartPartsByAlias(
            alias,
            { uploadId, objectName },
            password ? { password } : undefined,
          );
          return response.data.parts;
        },
      },
    });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addFiles(acceptedFiles);
    },
    [addFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    disabled: isUploading,
  });

  const validateUploadRequirements = (): boolean => {
    if (fileUploads.length === 0) {
      toast.error(t("reverseShares.upload.errors.selectAtLeastOneFile"));
      return false;
    }

    const nameRequired = reverseShare.nameFieldRequired === "REQUIRED";
    const emailRequired = reverseShare.emailFieldRequired === "REQUIRED";

    if (nameRequired && !uploaderName.trim()) {
      toast.error(t("reverseShares.upload.errors.provideNameRequired"));
      return false;
    }

    if (emailRequired && !uploaderEmail.trim()) {
      toast.error(t("reverseShares.upload.errors.provideEmailRequired"));
      return false;
    }

    return true;
  };

  const handleUpload = async () => {
    if (!validateUploadRequirements()) return;
    startUpload();
  };

  const getCanUpload = (): boolean => {
    if (fileUploads.length === 0 || isUploading) return false;

    const nameRequired = reverseShare.nameFieldRequired === "REQUIRED";
    const emailRequired = reverseShare.emailFieldRequired === "REQUIRED";
    const nameHidden = reverseShare.nameFieldRequired === "HIDDEN";
    const emailHidden = reverseShare.emailFieldRequired === "HIDDEN";

    if (nameHidden && emailHidden) return true;

    if (nameRequired && !uploaderName.trim()) return false;

    if (emailRequired && !uploaderEmail.trim()) return false;

    return true;
  };

  const canUpload = getCanUpload();
  const allFilesProcessed = fileUploads.every(
    (file) => file.status === "success" || file.status === "error",
  );
  const hasSuccessfulUploads = fileUploads.some((file) => file.status === "success");

  const getDragActiveStyles = () => {
    if (isDragActive) {
      return "border-green-500 bg-primary/5";
    }
    return "border-border hover:border-border/70";
  };

  const getDropzoneStyles = () => {
    const baseStyles =
      "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors";
    const dragStyles = getDragActiveStyles();
    const disabledStyles = isUploading ? "opacity-50 cursor-not-allowed" : "";

    return `${baseStyles} ${dragStyles} ${disabledStyles}`.trim();
  };

  const renderFileRestrictions = () => {
    const calculateRemainingFiles = (): number => {
      if (!reverseShare.maxFiles) return 0;
      const currentTotal = reverseShare.currentFileCount + fileUploads.length;
      const remaining = reverseShare.maxFiles - currentTotal;
      return Math.max(0, remaining);
    };

    const remainingFiles = calculateRemainingFiles();

    return (
      <p className="text-sm text-muted-foreground">
        {reverseShare.allowedFileTypes && (
          <>
            {t("reverseShares.upload.fileDropzone.acceptedTypes", {
              types: reverseShare.allowedFileTypes,
            })}
            <br />
          </>
        )}
        {reverseShare.maxFileSize && (
          <>
            {t("reverseShares.upload.fileDropzone.maxFileSize", {
              size: formatFileSize(reverseShare.maxFileSize),
            })}
            <br />
          </>
        )}
        {reverseShare.maxFiles &&
          t("reverseShares.upload.fileDropzone.remainingFiles", {
            remaining: remainingFiles,
            max: reverseShare.maxFiles,
          })}
      </p>
    );
  };

  const renderFileStatusBadge = (fileStatus: string) => {
    if (fileStatus === "success") {
      return (
        <Badge
          variant="default"
          className="bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800"
        >
          <Check className="h-3 w-3 me-1" />
          {t("reverseShares.upload.fileList.statusUploaded")}
        </Badge>
      );
    }

    if (fileStatus === "error") {
      return <Badge variant="destructive">{t("reverseShares.upload.fileList.statusError")}</Badge>;
    }

    return null;
  };

  const renderFileItem = (upload: FileUploadState) => (
    <div key={upload.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
      <File className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{upload.file.name}</p>
        <p className="text-xs text-muted-foreground">{formatFileSize(upload.file.size)}</p>
        {upload.status === "uploading" && <Progress value={upload.progress} className="mt-2 h-2" />}
        {upload.status === "error" && upload.error && (
          <p className="text-xs text-red-500 mt-1">{upload.error}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {renderFileStatusBadge(upload.status)}
        {upload.status === "pending" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => removeFile(upload.id)}
            disabled={isUploading}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {upload.status === "error" && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => retryUpload(upload.id)}
              disabled={isUploading}
              title={t("reverseShares.upload.errors.retry")}
            >
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeFile(upload.id)}
              disabled={isUploading}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div {...getRootProps()} className={getDropzoneStyles()}>
        <input {...getInputProps()} />
        <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          {isDragActive
            ? t("reverseShares.upload.fileDropzone.dragActive")
            : t("reverseShares.upload.fileDropzone.dragInactive")}
        </h3>
        {renderFileRestrictions()}
      </div>

      {fileUploads.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-foreground">
            {t("reverseShares.upload.fileList.title")}
          </h4>
          {fileUploads.map(renderFileItem)}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          {reverseShare.nameFieldRequired !== "HIDDEN" && (
            <div className="space-y-2">
              <Label htmlFor="name">
                <User className="inline h-4 w-4" />
                {reverseShare.nameFieldRequired === "OPTIONAL"
                  ? t("reverseShares.upload.form.nameLabelOptional")
                  : t("reverseShares.upload.form.nameLabel")}
                {reverseShare.nameFieldRequired === "REQUIRED" && (
                  <span className="text-red-500 ms-1">*</span>
                )}
              </Label>
              <Input
                id="name"
                placeholder={t("reverseShares.upload.form.namePlaceholder")}
                value={uploaderName}
                onChange={(e) => setUploaderName(e.target.value)}
                disabled={isUploading}
                required={reverseShare.nameFieldRequired === "REQUIRED"}
              />
            </div>
          )}
          {reverseShare.emailFieldRequired !== "HIDDEN" && (
            <div className="space-y-2">
              <Label htmlFor="email">
                <Mail className="inline h-4 w-4" />
                {reverseShare.emailFieldRequired === "OPTIONAL"
                  ? t("reverseShares.upload.form.emailLabelOptional")
                  : t("reverseShares.upload.form.emailLabel")}
                {reverseShare.emailFieldRequired === "REQUIRED" && (
                  <span className="text-red-500 ms-1">*</span>
                )}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t("reverseShares.upload.form.emailPlaceholder")}
                value={uploaderEmail}
                onChange={(e) => setUploaderEmail(e.target.value)}
                disabled={isUploading}
                required={reverseShare.emailFieldRequired === "REQUIRED"}
              />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">{t("reverseShares.upload.form.descriptionLabel")}</Label>
          <Textarea
            id="description"
            placeholder={t("reverseShares.upload.form.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isUploading}
            rows={UPLOAD_CONFIG.TEXTAREA_ROWS}
          />
        </div>
      </div>

      <Button
        onClick={handleUpload}
        disabled={!canUpload}
        className="w-full text-primary-foreground"
        size="lg"
        variant="default"
      >
        {isUploading
          ? t("reverseShares.upload.form.uploading")
          : t("reverseShares.upload.form.uploadButton", { count: fileUploads.length })}
      </Button>

      {allFilesProcessed && hasSuccessfulUploads && (
        <div className="text-center p-4 bg-emerald-500/10 rounded-lg">
          <p className="text-emerald-800 dark:text-emerald-200 font-medium">
            {t("reverseShares.upload.success.title")}
          </p>
          <p className="text-sm text-emerald-600 dark:text-emerald-300 mt-1">
            {t("reverseShares.upload.success.description")}
          </p>
        </div>
      )}
    </div>
  );
}
