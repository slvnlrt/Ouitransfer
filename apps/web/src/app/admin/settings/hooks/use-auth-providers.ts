"use client";

import type { DropResult } from "@hello-pangea/dnd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  createProvider,
  deleteProvider as deleteProviderEndpoint,
  getAllProviders,
  updateProvider as updateProviderEndpoint,
  updateProvidersOrder as updateProvidersOrderEndpoint,
} from "@/http/endpoints";
import type { AuthProvider, NewProvider } from "@/http/endpoints/auth/types";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import type { ProviderFormDataMap } from "../components/auth-provider-form/types";

export function useAuthProviders() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  // --- UI state ---
  const [saving, setSaving] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<AuthProvider | null>(null);
  const [editingFormData, setEditingFormData] = useState<ProviderFormDataMap>({});
  const [hideDisabledProviders, setHideDisabledProviders] = useState<boolean>(false);
  const [providerToDelete, setProviderToDelete] = useState<{
    id: string;
    name: string;
    displayName: string;
  } | null>(null);

  useEffect(() => {
    const savedState = localStorage.getItem("hideDisabledProviders");
    if (savedState !== null) {
      setHideDisabledProviders(JSON.parse(savedState));
    }
  }, []);

  // --- Server state via TanStack Query ---
  const providersQuery = useQuery({
    queryKey: queryKeys.auth.providers.all(),
    queryFn: async () => {
      const response = await getAllProviders();
      const data = response.data;

      if (data.success) {
        return data.data.sort((a: AuthProvider, b: AuthProvider) => a.sortOrder - b.sortOrder);
      }
      throw new Error("Failed to load providers");
    },
  });

  const providers = providersQuery.data ?? [];
  const loading = providersQuery.isLoading;

  // --- Mutations ---

  const updateProviderMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AuthProvider> }) => {
      const response = await updateProviderEndpoint(id, updates);
      const data = response.data;
      if (!data.success) {
        throw new Error("Update failed");
      }
      return data;
    },
    onMutate: ({ id }) => {
      setSaving(id);
    },
    onSuccess: () => {
      toast.success(t("authProviders.messages.providerUpdated"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
    },
    onError: (error) => {
      logger.error("Error updating provider", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("authProviders.messages.updateFailed"));
    },
    onSettled: () => {
      setSaving(null);
    },
  });

  const addProviderMutation = useMutation({
    mutationFn: async (newProvider: NewProvider) => {
      const response = await createProvider({
        name: newProvider.name.toLowerCase().replace(/\s+/g, "-"),
        displayName: newProvider.displayName,
        type: newProvider.type,
        icon: newProvider.icon,
        clientId: newProvider.clientId,
        clientSecret: newProvider.clientSecret,
        scope:
          newProvider.scope ||
          (newProvider.type === "oidc" ? "openid profile email" : "user:email"),
        ...(newProvider.issuerUrl ? { issuerUrl: newProvider.issuerUrl } : {}),
        ...(newProvider.authorizationEndpoint
          ? { authorizationEndpoint: newProvider.authorizationEndpoint }
          : {}),
        ...(newProvider.tokenEndpoint ? { tokenEndpoint: newProvider.tokenEndpoint } : {}),
        ...(newProvider.userInfoEndpoint ? { userInfoEndpoint: newProvider.userInfoEndpoint } : {}),
      });
      const data = response.data;
      if (!data.success) {
        throw new Error("Add failed");
      }
      return data;
    },
    onMutate: () => {
      setSaving("new");
    },
    onSuccess: () => {
      toast.success(t("authProviders.messages.providerAdded"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
    },
    onError: (error) => {
      logger.error("Error adding provider", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("authProviders.messages.addFailed"));
    },
    onSettled: () => {
      setSaving(null);
    },
  });

  const editProviderMutation = useMutation({
    mutationFn: async ({
      providerId,
      providerData,
    }: {
      providerId: string;
      providerData: Partial<AuthProvider>;
    }) => {
      const response = await updateProviderEndpoint(providerId, {
        ...providerData,
        name: providerData.name?.toLowerCase().replace(/\s+/g, "-"),
      });
      const data = response.data;
      if (!data.success) {
        throw new Error("Edit failed");
      }
      return data;
    },
    onMutate: ({ providerId }) => {
      setSaving(providerId);
    },
    onSuccess: () => {
      setEditingProvider(null);
      toast.success(t("authProviders.messages.providerUpdated"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
    },
    onError: (error) => {
      logger.error("Error updating provider", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("authProviders.messages.updateFailed"));
    },
    onSettled: () => {
      setSaving(null);
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await deleteProviderEndpoint(id);
      const data = response.data;
      if (!data.success) {
        throw new Error("Delete failed");
      }
      return data;
    },
    onSuccess: () => {
      toast.success(t("authProviders.messages.providerDeleted"));
      setProviderToDelete(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
    },
    onError: (error) => {
      logger.error("Error deleting provider", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("authProviders.messages.deleteFailed"));
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (updatedProviders: Array<{ id: string; sortOrder: number }>) => {
      const response = await updateProvidersOrderEndpoint({ providers: updatedProviders });
      const data = response.data;
      if (!data.success) {
        throw new Error("Order update failed");
      }
      return data;
    },
    onSuccess: () => {
      toast.success(t("authProviders.messages.providerOrderUpdated"));
    },
    onError: (error) => {
      logger.error("Error updating provider order", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("authProviders.messages.orderUpdateFailed"));
      // Rollback by refetching from server
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
    },
  });

  // --- Wrapper functions (preserve the original function signatures for consumers) ---

  const updateProvider = async (id: string, updates: Partial<AuthProvider>) => {
    await updateProviderMutation.mutateAsync({ id, updates });
  };

  const addProvider = async (newProvider: NewProvider) => {
    await addProviderMutation.mutateAsync(newProvider);
  };

  const editProvider = async (providerData: Partial<AuthProvider>) => {
    if (!editingProvider || !providerData.name || !providerData.displayName) {
      toast.error(t("authProviders.messages.fillRequiredFields"));
      return;
    }

    await editProviderMutation.mutateAsync({
      providerId: editingProvider.id,
      providerData,
    });
  };

  const deleteProvider = async (id: string) => {
    await deleteProviderMutation.mutateAsync(id);
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(providers);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    const updatedItems = items.map((provider, index) => ({
      ...provider,
      sortOrder: index + 1,
    }));

    // Optimistic update: set the cache immediately for instant drag feedback
    queryClient.setQueryData(queryKeys.auth.providers.all(), updatedItems);

    const updatedProviders = updatedItems.map((provider) => ({
      id: provider.id,
      sortOrder: provider.sortOrder,
    }));

    reorderMutation.mutate(updatedProviders);
  };

  // --- Pure UI handlers ---

  const loadProviders = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.auth.providers.all() });
  };

  const handleHideDisabledProvidersChange = (checked: boolean) => {
    setHideDisabledProviders(checked);
    localStorage.setItem("hideDisabledProviders", JSON.stringify(checked));
  };

  const handleEditProvider = (provider: AuthProvider) => {
    if (editingProvider?.id === provider.id) {
      setEditingProvider(null);
    } else {
      setEditingProvider(provider);
    }
  };

  const handleDeleteProvider = (provider: AuthProvider) => {
    setProviderToDelete({
      id: provider.id,
      name: provider.name,
      displayName: provider.displayName,
    });
  };

  const handleCancelEdit = () => {
    setEditingProvider(null);
    setEditingFormData({});
  };

  // --- Computed ---
  const enabledCount = providers.filter((p) => p.enabled).length;
  const filteredProviders = hideDisabledProviders ? providers.filter((p) => p.enabled) : providers;

  return {
    // State
    providers,
    loading,
    saving,
    editingProvider,
    editingFormData,
    hideDisabledProviders,
    providerToDelete,
    isDeleting: deleteProviderMutation.isPending,

    // Computed
    enabledCount,
    filteredProviders,

    // Actions
    loadProviders,
    updateProvider,
    addProvider,
    editProvider,
    deleteProvider,
    handleDragEnd,
    handleHideDisabledProvidersChange,
    handleEditProvider,
    handleDeleteProvider,
    handleCancelEdit,

    // Setters
    setEditingFormData,
    setProviderToDelete,
  };
}
