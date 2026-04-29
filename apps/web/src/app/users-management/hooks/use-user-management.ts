"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/contexts/auth-context";
import { useDisclosure } from "@/hooks/use-disclosure";
import {
  activateUser,
  deactivateUser,
  deleteUser,
  listUsers,
  registerUser,
  updateUser,
} from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

const createSchemas = (t: (key: string) => string) => ({
  userSchema: z.object({
    firstName: z.string().min(1, t("validation.firstNameRequired")),
    lastName: z.string().min(1, t("validation.lastNameRequired")),
    username: z
      .string()
      .min(3, t("validation.usernameLength"))
      .regex(/^[^\s]+$/, t("validation.usernameSpaces")),
    email: z.string().email(t("validation.invalidEmail")),
    password: z.string().min(8, t("validation.passwordLength")).or(z.literal("")),
    isAdmin: z
      .union([z.enum(["true", "false"]), z.boolean()])
      .transform((val) => (typeof val === "string" ? val === "true" : val))
      .optional(),
  }),
});

export type UserFormData = z.infer<ReturnType<typeof createSchemas>["userSchema"]>;

export function useUserManagement() {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const { userSchema } = createSchemas(t);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [deleteModalUser, setDeleteModalUser] = useState<User | null>(null);
  const [statusModalUser, setStatusModalUser] = useState<User | null>(null);

  const { user: currentUser } = useAuth();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isDeleteModalOpen,
    onOpen: onDeleteModalOpen,
    onClose: onDeleteModalClose,
  } = useDisclosure();
  const {
    isOpen: isStatusModalOpen,
    onOpen: onStatusModalOpen,
    onClose: onStatusModalClose,
  } = useDisclosure();

  const formMethods = useForm<UserFormData>({
    resolver: zodResolver(userSchema) as Resolver<UserFormData>,
  });

  // ── Query: load users list ────────────────────────────────────────
  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: async () => {
      const response = await listUsers();
      return response.data;
    },
  });

  const users = usersQuery.data ?? [];
  const isLoading = usersQuery.isLoading;

  // ── UI handlers (no network) ──────────────────────────────────────
  const handleCreateUser = () => {
    setModalMode("create");
    setSelectedUser(null);
    formMethods.reset({});
    onOpen();
  };

  const handleEditUser = (user: User) => {
    setModalMode("edit");
    setSelectedUser(user);
    formMethods.reset({
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      password: "",
    });
    onOpen();
  };

  // ── Mutation: create or update user ───────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      if (modalMode === "create") {
        await registerUser(data);
      } else {
        if (!selectedUser) return;
        const updateData = {
          ...data,
          id: selectedUser.id,
        } as { id: string } & Partial<typeof data>;

        if (!data.password || data.password.trim() === "") {
          delete updateData.password;
        }

        await updateUser(updateData);
      }
    },
    onSuccess: () => {
      toast.success(
        modalMode === "create"
          ? t("users.messages.createSuccess")
          : t("users.messages.updateSuccess"),
      );
      onClose();
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      toast.error(t("users.errors.submitFailed", { mode: t(`users.modes.${modalMode}`) }));
    },
  });

  const onSubmit = async (data: UserFormData) => {
    submitMutation.mutate(data);
  };

  // ── Mutation: delete user ─────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteModalUser) return;
      await deleteUser(deleteModalUser.id);
    },
    onSuccess: () => {
      toast.success(t("users.messages.deleteSuccess"));
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onDeleteModalClose();
    },
    onError: () => {
      toast.error(t("users.errors.deleteFailed"));
    },
  });

  const handleDeleteUser = async () => {
    if (!deleteModalUser) return;
    deleteMutation.mutate();
  };

  // ── Mutation: toggle user status ──────────────────────────────────
  const toggleStatusMutation = useMutation({
    mutationFn: async () => {
      if (!statusModalUser) return;
      if (statusModalUser.isActive) {
        await deactivateUser(statusModalUser.id);
      } else {
        await activateUser(statusModalUser.id);
      }
    },
    onSuccess: () => {
      toast.success(
        statusModalUser?.isActive
          ? t("users.messages.deactivateSuccess")
          : t("users.messages.activateSuccess"),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onStatusModalClose();
    },
    onError: () => {
      toast.error(t("users.errors.statusUpdateFailed"));
    },
  });

  const handleToggleUserStatus = async () => {
    if (!statusModalUser) return;
    toggleStatusMutation.mutate();
  };

  return {
    users,
    isLoading,
    currentUser,
    selectedUser,
    deleteModalUser,
    statusModalUser,
    modals: {
      isOpen,
      onOpen,
      onClose,
      modalMode,
      isDeleteModalOpen,
      onDeleteModalOpen,
      onDeleteModalClose,
      isStatusModalOpen,
      onStatusModalOpen,
      onStatusModalClose,
      setDeleteModalUser,
      setStatusModalUser,
    },
    handleCreateUser,
    handleEditUser,
    handleDeleteUser,
    handleToggleUserStatus,
    onSubmit,
    formMethods,
  };
}
