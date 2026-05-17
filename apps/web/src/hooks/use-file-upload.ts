import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";

import { type UseUppyUploadOptions, useUppyUpload } from "@/hooks/use-uppy-upload";
import { checkFile, getFilePresignedUrl, registerFile } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { parseApiError } from "@/utils/api-error";
import { generateSafeFileName } from "@/utils/file-utils";

interface UseFileUploadOptions {
  /** Folder ID that uploaded files should be placed into. */
  currentFolderId?: string;
}

/**
 * Convenience wrapper around `useUppyUpload` that wires up the standard
 * authenticated upload flow (checkFile → presigned URL → registerFile).
 *
 * Both `GlobalDropZone` and `UploadFileModal` previously duplicated this
 * exact configuration — this hook is the single source of truth.
 */
export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { currentFolderId } = options;
  const t = useTranslations();

  const uppyOptions: UseUppyUploadOptions = useMemo(
    () => ({
      onValidate: async (file: File) => {
        const fileName = file.name;
        const extension = fileName.split(".").pop() || "";
        const safeObjectName = generateSafeFileName(fileName);

        try {
          await checkFile({
            name: fileName,
            objectName: safeObjectName,
            size: file.size,
            extension: extension,
            folderId: currentFolderId,
          });
        } catch (error) {
          logger.error("File check failed:", {
            err: error instanceof Error ? error.message : String(error),
          });
          const apiError = parseApiError(error);
          let errorMessage = t("uploadFile.error");

          if (apiError.code === ErrorCodes.FILE_SIZE_EXCEEDED) {
            errorMessage = t("uploadFile.fileSizeExceeded", {
              maxsizemb: String(apiError.details?.maxSizeMB ?? "0"),
            });
          } else if (apiError.code === ErrorCodes.INSUFFICIENT_STORAGE) {
            errorMessage = t("uploadFile.insufficientStorage", {
              availablespace: String(apiError.details?.availableSpaceMB ?? "0"),
            });
          }

          toast.error(errorMessage);
          throw new Error(errorMessage);
        }
      },

      onBeforeUpload: async (file: File) => {
        const safeObjectName = generateSafeFileName(file.name);
        return safeObjectName;
      },

      getPresignedUrl: async (objectName: string, extension: string) => {
        const response = await getFilePresignedUrl({
          filename: objectName.replace(`.${extension}`, ""),
          extension,
        });

        // IMPORTANT: Use the objectName returned by backend, not the one we generated!
        // The backend generates: userId/timestamp-random-filename.extension
        const actualObjectName = response.data.objectName;

        return { url: response.data.url, method: "PUT", actualObjectName };
      },

      onAfterUpload: async (_fileId: string, file: File, objectName: string) => {
        const fileName = file.name;
        const extension = fileName.split(".").pop() || "";

        await registerFile({
          name: fileName,
          objectName,
          size: file.size,
          extension,
          folderId: currentFolderId,
        });
      },
    }),
    [currentFolderId, t],
  );

  return useUppyUpload(uppyOptions);
}
