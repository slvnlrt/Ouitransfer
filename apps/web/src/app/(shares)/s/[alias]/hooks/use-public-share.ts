"use client";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getShareByAlias, getShareMetadata, identifyVisitor } from "@/http/endpoints/index";
import type { IdentifyVisitorBody, Share } from "@/http/endpoints/shares/types";
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

/**
 * Checks whether an error is an "Identification required" response.
 */
function isIdentificationRequired(error: unknown): boolean {
  return parseApiError(error).code === ErrorCodes.IDENTIFICATION_REQUIRED;
}

export function usePublicShare() {
  const t = useTranslations();
  const params = useParams();
  const queryClient = useQueryClient();
  const alias = params?.alias as string;

  // --- UI-only state (not server-derived) ---
  const [password, setPassword] = useState("");
  const [isPasswordError, setIsPasswordError] = useState(false);
  const [isIdentificationSubmitting, setIsIdentificationSubmitting] = useState(false);
  // Tracks when password was accepted but identification is still required.
  // We use both state (for re-render) and a ref (for immediate access in queryFn).
  const [acceptedPassword, setAcceptedPassword] = useState<string | null>(null);
  const acceptedPasswordRef = useRef<string | null>(null);

  // --- Initial share fetch via useQuery ---
  const shareQuery = useQuery({
    queryKey: queryKeys.shares.byAlias(alias),
    queryFn: async () => {
      // Use the ref to avoid stale closure — invalidateQueries triggers refetch
      // before React re-renders with updated state.
      const storedPassword = acceptedPasswordRef.current;
      const params = storedPassword ? { password: storedPassword } : undefined;
      // NOTE: Password is re-sent on every refetch (the server re-validates).
      // This is acceptable — the alternative (session cookie) would add complexity
      // for marginal benefit.
      const response = await getShareByAlias(alias, params);
      return response.data.share;
    },
    enabled: !!alias,
    retry: false, // 401 (password required) should not retry
  });

  // --- Derived: identification modal is open when query fails with IDENTIFICATION_REQUIRED,
  //     OR when password was accepted but identification is still needed ---
  const isIdentificationModalOpen =
    !shareQuery.data &&
    (isIdentificationRequired(shareQuery.error) ||
      (acceptedPassword !== null && isPasswordRequired(shareQuery.error)));

  // --- Fetch share metadata to know which fields to show (only when identification is required) ---
  const metadataQuery = useQuery({
    queryKey: queryKeys.shares.metadata(alias),
    queryFn: async () => {
      const response = await getShareMetadata(alias);
      return response.data.metadata;
    },
    enabled: !!alias && isIdentificationModalOpen,
    retry: false,
  });

  // --- React to non-password, non-identification query errors ---
  useEffect(() => {
    if (!shareQuery.error) return;
    if (!isPasswordRequired(shareQuery.error) && !isIdentificationRequired(shareQuery.error)) {
      toast.error(t("share.errors.loadFailed"));
    }
  }, [shareQuery.error, t]);

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
      } else if (isIdentificationRequired(error)) {
        // Password was correct but identification is also required.
        // Store the accepted password so subsequent fetches include it,
        // then refetch — the query will now use the stored password.
        acceptedPasswordRef.current = password;
        setAcceptedPassword(password);
        queryClient.invalidateQueries({ queryKey: queryKeys.shares.byAlias(alias) });
      } else {
        toast.error(t("share.errors.loadFailed"));
      }

      logger.error("Failed to load share with password", {
        alias,
        err: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // --- Identification submit mutation ---
  const identificationMutation = useMutation({
    mutationFn: async (body: IdentifyVisitorBody) => {
      await identifyVisitor(alias, body);
    },
    onSuccess: () => {
      // The server has now set the visitor cookie — re-fetch the share
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.byAlias(alias) });
      setIsIdentificationSubmitting(false);
    },
    onError: (error: unknown) => {
      const apiError = parseApiError(error);
      if (apiError.statusCode === 429) {
        toast.error(t("share.identification.rateLimited"));
      } else {
        toast.error(t("share.identification.error"));
      }
      setIsIdentificationSubmitting(false);
      logger.error("Failed to identify visitor", {
        alias,
        err: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // --- Derived state from TQ cache ---
  const share: Share | null = shareQuery.data ?? null;
  const isLoading =
    shareQuery.isLoading || passwordMutation.isPending || identificationMutation.isPending;
  // Show the password modal when the query fails with "Password required" and we don't have share data yet
  // Don't show it if the password was already accepted (identification step is next)
  const isPasswordModalOpen =
    !share && acceptedPassword === null && isPasswordRequired(shareQuery.error);

  // --- Password submit handler (reads password from state, matches original signature) ---
  const handlePasswordSubmit = async () => {
    passwordMutation.mutate(password);
  };

  // --- Identification submit handler ---
  const handleIdentificationSubmit = (name: string | undefined, email: string | undefined) => {
    setIsIdentificationSubmitting(true);
    identificationMutation.mutate({ name, email });
  };

  // --- Compose sub-hooks ---
  const downloads = usePublicShareDownload(share, password);
  const navigation = usePublicShareNavigation(share, shareQuery.isLoading);

  // I-3: Clear password error when user types a new value
  const handleSetPassword = (value: string) => {
    setPassword(value);
    if (isPasswordError) {
      setIsPasswordError(false);
    }
  };

  return {
    // Original functionality
    isLoading,
    share,
    password,
    isPasswordModalOpen,
    isPasswordError,
    setPassword: handleSetPassword,
    handlePasswordSubmit,

    // Identification functionality
    isIdentificationModalOpen,
    isIdentificationSubmitting,
    shareMetadata: metadataQuery.data ?? null,
    metadataError: metadataQuery.isError,
    refetchMetadata: metadataQuery.refetch,
    handleIdentificationSubmit,

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
