"use client";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getShareByAlias } from "@/http/endpoints/index";
import type { Share } from "@/http/endpoints/shares/types";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import { usePublicShareDownload } from "./use-public-share-download";
import { usePublicShareNavigation } from "./use-public-share-navigation";

/**
 * Checks whether an error is a "Password required" response.
 */
function isPasswordRequired(error: unknown): boolean {
  return parseApiError(error).code === ErrorCodes.PASSWORD_REQUIRED;
}

/**
 * Checks whether an error is an "Invalid password" response.
 */
function isInvalidPassword(error: unknown): boolean {
  return parseApiError(error).code === ErrorCodes.INVALID_PASSWORD;
}

export function usePublicShare() {
  const t = useTranslations();
  const params = useParams();
  const queryClient = useQueryClient();
  const alias = params?.alias as string;

  // --- UI-only state (not server-derived) ---
  const [password, setPassword] = useState("");
  const [isPasswordError, setIsPasswordError] = useState(false);

  // --- Initial share fetch via useQuery ---
  const shareQuery = useQuery({
    queryKey: queryKeys.shares.byAlias(alias),
    queryFn: async () => {
      const response = await getShareByAlias(alias);
      return response.data.share;
    },
    enabled: !!alias,
    retry: false, // 401 (password required) should not retry
  });

  // --- React to non-password query errors ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: t is stable from next-intl; including it risks re-firing the error toast
  useEffect(() => {
    if (!shareQuery.error) return;
    if (!isPasswordRequired(shareQuery.error)) {
      toast.error(t("share.errors.loadFailed"));
    }
  }, [shareQuery.error]);

  // --- Password submit mutation ---
  const passwordMutation = useMutation({
    mutationFn: async (submittedPassword: string) => {
      const response = await getShareByAlias(alias, { password: submittedPassword });
      return response.data.share;
    },
    onSuccess: (shareData: Share) => {
      // Inject the fetched data into the query cache — the modal auto-closes
      // because isPasswordModalOpen is derived from `!share && isPasswordRequired`
      queryClient.setQueryData(queryKeys.shares.byAlias(alias), shareData);
      setIsPasswordError(false);
    },
    onError: (error: unknown) => {
      if (isInvalidPassword(error)) {
        setIsPasswordError(true);
        toast.error(t("share.errors.invalidPassword"));
      } else {
        toast.error(t("share.errors.loadFailed"));
      }

      logger.error("Failed to load share with password", {
        alias,
        err: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // --- Derived state from TQ cache ---
  const share: Share | null = shareQuery.data ?? null;
  const isLoading = shareQuery.isLoading || passwordMutation.isPending;
  // Show the password modal when the query fails with "Password required" and we don't have share data yet
  const isPasswordModalOpen = !share && isPasswordRequired(shareQuery.error);

  // --- Password submit handler (reads password from state, matches original signature) ---
  const handlePasswordSubmit = async () => {
    passwordMutation.mutate(password);
  };

  // --- Compose sub-hooks ---
  const downloads = usePublicShareDownload(share, password);
  const navigation = usePublicShareNavigation(share, shareQuery.isLoading);

  return {
    // Original functionality
    isLoading,
    share,
    password,
    isPasswordModalOpen,
    isPasswordError,
    setPassword,
    handlePasswordSubmit,

    // Download functionality (from sub-hook)
    handleDownload: downloads.handleDownload,
    handleBulkDownload: downloads.handleBulkDownload,
    handleSelectedItemsBulkDownload: downloads.handleSelectedItemsBulkDownload,

    // Browse functionality (from sub-hook)
    folders: navigation.folders,
    files: navigation.files,
    path: navigation.path,
    isBrowseLoading: navigation.isBrowseLoading,
    browseError: navigation.browseError,
    currentFolderId: navigation.currentFolderId,
    searchQuery: navigation.searchQuery,
    navigateToFolder: navigation.navigateToFolder,
    handleSearch: navigation.handleSearch,
    reload: () => queryClient.invalidateQueries({ queryKey: queryKeys.shares.byAlias(alias) }),
  };
}
