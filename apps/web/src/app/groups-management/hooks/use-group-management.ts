"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDisclosure } from "@/hooks/use-disclosure";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "@/http/endpoints";
import type { GroupDetail, GroupListItem } from "@/http/endpoints/groups/types";
import { queryKeys } from "@/lib/query-keys";

const createSchemas = (t: (key: string) => string) => ({
  groupSchema: z.object({
    name: z.string().min(1, t("groups.validation.nameRequired")).max(100),
    description: z.string().max(500).optional().or(z.literal("")),
  }),
});

export type GroupFormData = z.infer<ReturnType<typeof createSchemas>["groupSchema"]>;

export function useGroupManagement() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const { groupSchema } = createSchemas(t);
  const [selectedGroup, setSelectedGroup] = useState<GroupListItem | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [deleteModalGroup, setDeleteModalGroup] = useState<GroupListItem | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isDeleteModalOpen,
    onOpen: onDeleteModalOpen,
    onClose: onDeleteModalClose,
  } = useDisclosure();
  const {
    isOpen: isDetailModalOpen,
    onOpen: onDetailModalOpen,
    onClose: onDetailModalClose,
  } = useDisclosure();

  const formMethods = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema) as Resolver<GroupFormData>,
  });

  // ── Query: load groups list ───────────────────────────────────────
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: async () => {
      const response = await listGroups();
      return response.data;
    },
  });

  const groups = groupsQuery.data ?? [];
  const isLoading = groupsQuery.isLoading;

  // ── Query: load group detail ──────────────────────────────────────
  const detailQuery = useQuery({
    queryKey: queryKeys.groups.detail(detailGroupId ?? ""),
    queryFn: async () => {
      const response = await getGroup(detailGroupId!);
      return response.data;
    },
    enabled: isDetailModalOpen && !!detailGroupId,
  });

  const detailGroup: GroupDetail | null = detailQuery.data ?? null;
  const isDetailLoading = detailQuery.isLoading;

  // ── UI handlers (no network) ──────────────────────────────────────
  const handleCreateGroup = () => {
    setModalMode("create");
    setSelectedGroup(null);
    formMethods.reset({ name: "", description: "" });
    onOpen();
  };

  const handleEditGroup = (group: GroupListItem) => {
    setModalMode("edit");
    setSelectedGroup(group);
    formMethods.reset({
      name: group.name,
      description: group.description ?? "",
    });
    onOpen();
  };

  const handleViewDetails = (group: GroupListItem) => {
    setDetailGroupId(group.id);
    onDetailModalOpen();
  };

  // ── Mutation: create or update group ──────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async (
      data: GroupFormData & {
        maxFileSizeOverride?: string | number | null;
        maxTotalStorageOverride?: string | number | null;
      },
    ) => {
      if (modalMode === "create") {
        await createGroup({
          name: data.name,
          description: data.description || undefined,
          maxFileSizeOverride: data.maxFileSizeOverride,
          maxTotalStorageOverride: data.maxTotalStorageOverride,
        });
      } else {
        if (!selectedGroup) return;
        await updateGroup(selectedGroup.id, {
          name: data.name,
          description: data.description || null,
          maxFileSizeOverride: data.maxFileSizeOverride,
          maxTotalStorageOverride: data.maxTotalStorageOverride,
        });
      }
    },
    onSuccess: () => {
      toast.success(
        modalMode === "create"
          ? t("groups.messages.createSuccess")
          : t("groups.messages.updateSuccess"),
      );
      onClose();
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
    onError: () => {
      toast.error(t("groups.errors.submitFailed", { mode: t(`groups.modes.${modalMode}`) }));
    },
  });

  const onSubmit = async (
    data: GroupFormData & {
      maxFileSizeOverride?: string | number | null;
      maxTotalStorageOverride?: string | number | null;
    },
  ) => {
    submitMutation.mutate(data);
  };

  // ── Mutation: delete group ────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteModalGroup) return;
      await deleteGroup(deleteModalGroup.id);
    },
    onSuccess: () => {
      toast.success(t("groups.messages.deleteSuccess"));
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onDeleteModalClose();
    },
    onError: () => {
      toast.error(t("groups.errors.deleteFailed"));
    },
  });

  const handleDeleteGroup = async () => {
    if (!deleteModalGroup) return;
    deleteMutation.mutate();
  };

  // ── Mutation: add member ──────────────────────────────────────────
  const addMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!detailGroupId) return;
      await addGroupMember(detailGroupId, { userId });
    },
    onSuccess: () => {
      toast.success(t("groups.messages.memberAdded"));
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(detailGroupId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      toast.error(t("groups.errors.addMemberFailed"));
    },
  });

  const handleAddMember = (userId: string) => {
    addMemberMutation.mutate(userId);
  };

  // ── Mutation: remove member ───────────────────────────────────────
  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!detailGroupId) return;
      await removeGroupMember(detailGroupId, userId);
    },
    onSuccess: () => {
      toast.success(t("groups.messages.memberRemoved"));
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.detail(detailGroupId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      toast.error(t("groups.errors.removeMemberFailed"));
    },
  });

  const handleRemoveMember = (userId: string) => {
    removeMemberMutation.mutate(userId);
  };

  return {
    groups,
    isLoading,
    selectedGroup,
    deleteModalGroup,
    detailGroup,
    isDetailLoading,
    modals: {
      isOpen,
      onOpen,
      onClose,
      modalMode,
      isDeleteModalOpen,
      onDeleteModalOpen,
      onDeleteModalClose,
      isDetailModalOpen,
      onDetailModalOpen,
      onDetailModalClose,
      setDeleteModalGroup,
    },
    handleCreateGroup,
    handleEditGroup,
    handleViewDetails,
    handleDeleteGroup,
    handleAddMember,
    handleRemoveMember,
    onSubmit,
    formMethods,
  };
}
