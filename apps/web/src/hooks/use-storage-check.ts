"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import { checkUploadAllowed } from "@/http/endpoints/app";

/**
 * Result of a storage availability check.
 */
export interface StorageCheckResult {
  /** Whether the upload is allowed (enough space available) */
  allowed: boolean;
  /** Available disk space in GB */
  availableGB: number;
  /** Required disk space in GB */
  requiredGB: number;
}

/**
 * Hook that provides a `checkStorageSpace` function.
 *
 * Call it with the total bytes to upload before starting the upload.
 * Returns `allowed: false` and shows an error toast if there is not enough space.
 */
export function useStorageCheck() {
  const t = useTranslations();

  const checkStorageSpace = useCallback(
    async (totalBytes: number): Promise<StorageCheckResult> => {
      const response = await checkUploadAllowed({ fileSize: String(totalBytes) });
      const { uploadAllowed, diskAvailableGB, fileSizeInfo } = response.data;

      if (!uploadAllowed) {
        toast.error(
          t("uploadFile.storageFull", {
            available: diskAvailableGB.toFixed(2),
            required: fileSizeInfo.gb.toFixed(2),
          }),
        );
      }

      return {
        allowed: uploadAllowed,
        availableGB: diskAvailableGB,
        requiredGB: fileSizeInfo.gb,
      };
    },
    [t],
  );

  return { checkStorageSpace };
}
