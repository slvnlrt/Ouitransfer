"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createReverseShare,
  createReverseShareAlias,
  deleteReverseShare,
  listUserReverseShares,
  updateReverseShare,
  updateReverseSharePassword,
} from "@/http/endpoints";
import type {
  CreateReverseShareBody,
  ListUserReverseSharesResult,
  UpdateReverseShareBody,
} from "@/http/endpoints/reverse-shares/types";
import { queryKeys } from "@/lib/query-keys";

export type ReverseShare = ListUserReverseSharesResult["data"]["reverseShares"][0];

export function useReverseShares() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  // --- UI state (not server state) ---
  const [searchQuery, setSearchQuery] = useState("");
  const [reverseShareToViewDetails, setReverseShareToViewDetails] = useState<ReverseShare | null>(
    null,
  );
  const [reverseShareToGenerateLink, setReverseShareToGenerateLink] = useState<ReverseShare | null>(
    null,
  );
  const [reverseShareToDelete, setReverseShareToDelete] = useState<ReverseShare | null>(null);
  const [reverseShareToEdit, setReverseShareToEdit] = useState<ReverseShare | null>(null);
  const [reverseShareToViewFiles, setReverseShareToViewFiles] = useState<ReverseShare | null>(null);
  const [reverseShareToViewQrCode, setReverseShareToViewQrCode] = useState<ReverseShare | null>(
    null,
  );
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // --- Server state via TanStack Query ---
  const reverseSharesQuery = useQuery({
    queryKey: queryKeys.reverseShares.list(),
    queryFn: async () => {
      const response = await listUserReverseShares();
      const allReverseShares = response.data.reverseShares || [];
      return [...allReverseShares].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
  });

  const reverseShares = reverseSharesQuery.data ?? [];
  const isLoading = reverseSharesQuery.isLoading;

  // Keep detail/files view state in sync with the list data.
  // When query data changes, the selected items are refreshed from the list.
  const syncedReverseShareToViewDetails = useMemo(() => {
    if (!reverseShareToViewDetails) return null;
    return (
      reverseShares.find((rs) => rs.id === reverseShareToViewDetails.id) ??
      reverseShareToViewDetails
    );
  }, [reverseShares, reverseShareToViewDetails]);

  const syncedReverseShareToViewFiles = useMemo(() => {
    if (!reverseShareToViewFiles) return null;
    return (
      reverseShares.find((rs) => rs.id === reverseShareToViewFiles.id) ?? reverseShareToViewFiles
    );
  }, [reverseShares, reverseShareToViewFiles]);

  // --- Mutations ---

  const createMutation = useMutation({
    mutationFn: (data: CreateReverseShareBody) => createReverseShare(data),
    onSuccess: (response) => {
      const newReverseShare = response.data.reverseShare;
      toast.success(t("reverseShares.messages.createSuccess"));
      setIsCreateModalOpen(false);
      setReverseShareToGenerateLink(newReverseShare as ReverseShare);
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.createFailed"));
    },
  });

  const createAliasMutation = useMutation({
    mutationFn: ({ reverseShareId, alias }: { reverseShareId: string; alias: string }) =>
      createReverseShareAlias(reverseShareId, { alias }),
    onSuccess: (_response, { reverseShareId, alias }) => {
      const newAlias = {
        id: "",
        alias,
        reverseShareId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Update the detail view immediately if it's for this reverse share
      if (reverseShareToViewDetails && reverseShareToViewDetails.id === reverseShareId) {
        setReverseShareToViewDetails({
          ...reverseShareToViewDetails,
          alias: newAlias,
        });
      }

      toast.success(t("reverseShares.messages.aliasCreated"));
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.aliasCreateFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (reverseShare: ReverseShare) => deleteReverseShare(reverseShare.id),
    onSuccess: () => {
      toast.success(t("reverseShares.messages.deleteSuccess"));
      setReverseShareToDelete(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.deleteFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateReverseShareBody) => updateReverseShare(data),
    onSuccess: () => {
      toast.success(t("reverseShares.messages.updateSuccess"));
      setReverseShareToEdit(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.updateFailed"));
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { hasPassword: boolean; password?: string };
    }) => {
      const payload = { password: data.hasPassword ? data.password! : null };
      return updateReverseSharePassword(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.updateFailed"));
    },
  });

  const updateDataMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Omit<UpdateReverseShareBody, "id"> }) => {
      const payload: UpdateReverseShareBody = { id, ...data };
      return updateReverseShare(payload);
    },
    onSuccess: () => {
      toast.success(t("reverseShares.messages.updateSuccess"));
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.updateFailed"));
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => {
      const payload: UpdateReverseShareBody = { id, isActive };
      return updateReverseShare(payload);
    },
    onSuccess: (_response, { isActive }) => {
      toast.success(
        isActive
          ? t("reverseShares.messages.activateSuccess")
          : t("reverseShares.messages.deactivateSuccess"),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
    },
    onError: () => {
      toast.error(t("reverseShares.errors.updateFailed"));
    },
  });

  // --- Wrapper functions (preserve the original function signatures for consumers) ---

  const handleCreateReverseShare = async (data: CreateReverseShareBody): Promise<void> => {
    await createMutation.mutateAsync(data);
  };

  const handleCreateAlias = async (reverseShareId: string, alias: string) => {
    await createAliasMutation.mutateAsync({ reverseShareId, alias });
  };

  const handleDeleteReverseShare = async (reverseShare: ReverseShare) => {
    await deleteMutation.mutateAsync(reverseShare);
  };

  const handleUpdateReverseShare = async (data: UpdateReverseShareBody): Promise<void> => {
    await updateMutation.mutateAsync(data);
  };

  const handleUpdatePassword = async (
    id: string,
    data: { hasPassword: boolean; password?: string },
  ) => {
    await updatePasswordMutation.mutateAsync({ id, data });
  };

  const handleUpdateReverseShareData = async (
    id: string,
    data: Omit<UpdateReverseShareBody, "id">,
  ): Promise<void> => {
    await updateDataMutation.mutateAsync({ id, data });
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await toggleActiveMutation.mutateAsync({ id, isActive });
  };

  const loadReverseShares = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
  };

  const refreshReverseShare = async (_id: string): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.reverseShares.list() });
  };

  // --- Computed ---

  const filteredReverseShares = reverseShares.filter(
    (reverseShare) => reverseShare.name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false,
  );

  const handleCopyLink = (reverseShare: ReverseShare) => {
    if (!reverseShare.alias?.alias) return;

    const link = `${window.location.origin}/r/${reverseShare.alias.alias}`;

    navigator.clipboard.writeText(link);
    toast.success(t("reverseShares.messages.linkCopied"));
  };

  return {
    reverseShares,
    isLoading,
    searchQuery,
    reverseShareToViewDetails: syncedReverseShareToViewDetails,
    reverseShareToGenerateLink,
    reverseShareToDelete,
    reverseShareToEdit,
    reverseShareToViewFiles: syncedReverseShareToViewFiles,
    reverseShareToViewQrCode,
    isDeleting: deleteMutation.isPending,
    isCreateModalOpen,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    filteredReverseShares,
    setSearchQuery,
    setReverseShareToViewDetails,
    setReverseShareToGenerateLink,
    setReverseShareToDelete,
    setReverseShareToEdit,
    setReverseShareToViewFiles,
    setReverseShareToViewQrCode,
    setIsCreateModalOpen,
    handleCopyLink,
    handleDeleteReverseShare,
    handleCreateReverseShare,
    handleUpdateReverseShare,
    handleCreateAlias,
    handleUpdatePassword,
    handleUpdateReverseShareData,
    handleToggleActive,
    loadReverseShares,
    refreshReverseShare,
  };
}
