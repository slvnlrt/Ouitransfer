"use client";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getReverseShareForUploadByAlias } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import type { ErrorType } from "../constants";
import type { ReverseShareInfo } from "../types";

interface UseReverseShareUploadProps {
  alias: string;
}

/**
 * Extracts an ErrorType from an error response.
 * Returns null for password-required/invalid-password errors (handled separately via password modal).
 */
function deriveErrorType(error: unknown): ErrorType {
  const apiError = parseApiError(error);
  switch (apiError.code) {
    case ErrorCodes.PASSWORD_REQUIRED:
    case ErrorCodes.INVALID_PASSWORD:
      // 401 is handled by the password modal flow, not as a page-level error
      return null;
    case ErrorCodes.NOT_FOUND:
      return "notFound";
    case ErrorCodes.SHARE_INACTIVE:
    case ErrorCodes.FORBIDDEN:
      return "inactive";
    case ErrorCodes.SHARE_EXPIRED:
    case ErrorCodes.GONE:
      return "expired";
    default:
      return "generic";
  }
}

/**
 * Checks whether an error is a password-required response.
 */
function isPasswordRequired(error: unknown): boolean {
  return parseApiError(error).code === ErrorCodes.PASSWORD_REQUIRED;
}

/**
 * Checks whether an error is an invalid-password response.
 */
function isInvalidPassword(error: unknown): boolean {
  return parseApiError(error).code === ErrorCodes.INVALID_PASSWORD;
}

export function useReverseShareUpload({ alias }: UseReverseShareUploadProps) {
  const router = useRouter();
  const t = useTranslations();
  const queryClient = useQueryClient();

  // --- UI-only state (not server-derived) ---
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [hasUploadedSuccessfully, setHasUploadedSuccessfully] = useState(false);

  const redirectToHome = useCallback(() => router.push("/"), [router]);

  // --- Initial fetch (without password) via useQuery ---
  const query = useQuery({
    queryKey: queryKeys.reverseShares.forUpload(alias),
    queryFn: async () => {
      const response = await getReverseShareForUploadByAlias(alias);
      return response.data.reverseShare;
    },
    enabled: !!alias,
    // The global retry config already skips 401/403/404.
    // We also want to skip 410 (GONE) since it's a permanent error.
    retry: false,
  });

  // --- React to query errors: open password modal or show toast ---
  useEffect(() => {
    if (!query.error) return;

    if (isPasswordRequired(query.error)) {
      setIsPasswordModalOpen(true);
    } else if (deriveErrorType(query.error) === "generic") {
      toast.error(t("reverseShares.upload.errors.loadFailed"));
    }

    if (query.error) {
      logger.error("Failed to load reverse share", {
        alias,
        err: query.error instanceof Error ? query.error.message : String(query.error),
      });
    }
  }, [query.error, alias, t]);

  // --- Password submit mutation ---
  const passwordMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await getReverseShareForUploadByAlias(alias, { password });
      return response.data.reverseShare;
    },
    onSuccess: (reverseShareData, password) => {
      // Inject the fetched data into the query cache
      queryClient.setQueryData(queryKeys.reverseShares.forUpload(alias), reverseShareData);
      setIsPasswordModalOpen(false);
      setCurrentPassword(password);
    },
    onError: (error: unknown) => {
      if (isInvalidPassword(error)) {
        setIsPasswordModalOpen(true);
        toast.error(t("reverseShares.upload.errors.passwordIncorrect"));
      } else if (isPasswordRequired(error)) {
        // Shouldn't happen on a password-authenticated request, but keep modal open
        setIsPasswordModalOpen(true);
      } else {
        // Non-auth error during password submission — close modal, show error
        setIsPasswordModalOpen(false);
        const errorType = deriveErrorType(error);
        if (errorType === "generic") {
          toast.error(t("reverseShares.upload.errors.loadFailed"));
        }
        // Force the query into an error state by invalidating
        queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.forUpload(alias) });
      }

      logger.error("Failed to load reverse share with password", {
        alias,
        err: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // --- Public API functions (preserve signatures for consumers) ---

  const handlePasswordSubmit = useCallback(
    (passwordValue: string) => {
      passwordMutation.mutate(passwordValue);
    },
    [passwordMutation],
  );

  const handlePasswordModalClose = useCallback(() => {
    redirectToHome();
  }, [redirectToHome]);

  const handleUploadSuccess = useCallback(() => {
    setHasUploadedSuccessfully(true);
  }, []);

  const resetUploadSuccess = useCallback(() => {
    setHasUploadedSuccessfully(false);
  }, []);

  /**
   * Backward-compatible reload function.
   * Without password: invalidates the query (re-fetches).
   * With password: triggers the password mutation.
   */
  const loadReverseShare = useCallback(
    async (passwordAttempt?: string) => {
      if (passwordAttempt) {
        await passwordMutation.mutateAsync(passwordAttempt);
      } else {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.reverseShares.forUpload(alias),
        });
      }
    },
    [alias, passwordMutation, queryClient],
  );

  // --- Derived state ---

  // The query data is the reverseShare object (or null if not yet loaded)
  const reverseShare: ReverseShareInfo | null = query.data ?? null;

  // Loading: either the initial query is loading or the password mutation is pending
  const isLoading = query.isLoading || passwordMutation.isPending;

  // Error type derived from either the query error or the mutation error (for non-auth errors)
  const errorType: ErrorType = useMemo(() => {
    // If query succeeded (we have data), there's no error
    if (query.data) return null;

    // If the query has an error, derive from it
    if (query.error) {
      return deriveErrorType(query.error);
    }

    return null;
  }, [query.data, query.error]);

  const isMaxFilesReached = reverseShare
    ? reverseShare.maxFiles !== null &&
      reverseShare.maxFiles !== undefined &&
      reverseShare.currentFileCount >= reverseShare.maxFiles
    : false;

  const isWeTransferLayout = reverseShare?.pageLayout === "WETRANSFER";
  const hasError = errorType !== null || (!reverseShare && !isLoading && !isPasswordModalOpen);

  const isLinkInactive = errorType === "inactive";
  const isLinkNotFound =
    errorType === "notFound" || (!reverseShare && !isLoading && !isPasswordModalOpen);
  const isLinkExpired = errorType === "expired";

  return {
    reverseShare,
    currentPassword,
    alias,

    isLoading,
    isPasswordModalOpen,
    hasUploadedSuccessfully,
    error: errorType,
    isMaxFilesReached,
    isWeTransferLayout,
    hasError,

    isLinkInactive,
    isLinkNotFound,
    isLinkExpired,

    handlePasswordSubmit,
    handlePasswordModalClose,
    handleUploadSuccess,
    resetUploadSuccess,
    loadReverseShare,
    redirectToHome,
  };
}
