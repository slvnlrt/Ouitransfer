"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getReverseShareForUploadByAlias } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { ERROR_MESSAGES, type ErrorType, HTTP_STATUS } from "../constants";
import type { ReverseShareInfo } from "../types";

interface UseReverseShareUploadProps {
  alias: string;
}

/**
 * Extracts an ErrorType from an axios error response.
 * Returns null for 401 errors (handled separately via password modal).
 */
function deriveErrorType(error: unknown): ErrorType {
  if (!axios.isAxiosError(error)) return "generic";

  const status = error.response?.status;
  switch (status) {
    case HTTP_STATUS.UNAUTHORIZED:
      // 401 is handled by the password modal flow, not as a page-level error
      return null;
    case HTTP_STATUS.NOT_FOUND:
      return "notFound";
    case HTTP_STATUS.FORBIDDEN:
      return "inactive";
    case HTTP_STATUS.GONE:
      return "expired";
    default:
      return "generic";
  }
}

/**
 * Checks whether an axios error is a 401 requiring a password.
 */
function isPasswordRequired(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return (
    error.response?.status === HTTP_STATUS.UNAUTHORIZED &&
    error.response?.data?.error === ERROR_MESSAGES.PASSWORD_REQUIRED
  );
}

/**
 * Checks whether an axios error is a 401 with an invalid password.
 */
function isInvalidPassword(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return (
    error.response?.status === HTTP_STATUS.UNAUTHORIZED &&
    error.response?.data?.error === ERROR_MESSAGES.INVALID_PASSWORD
  );
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
