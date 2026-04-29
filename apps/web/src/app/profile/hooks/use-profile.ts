"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/contexts/auth-context";
import { getCurrentUser, removeAvatar, updateUser, uploadAvatar } from "@/http/endpoints";
import type { User } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";

const createSchemas = (t: (key: string) => string) => ({
  profileSchema: z.object({
    firstName: z.string().min(1, t("validation.firstNameRequired")),
    lastName: z.string().min(1, t("validation.lastNameRequired")),
    username: z
      .string()
      .min(3, t("validation.usernameLength"))
      .regex(/^[^\s]+$/, t("validation.usernameSpaces")),
    email: z.string().email(t("validation.invalidEmail")),
  }),

  passwordSchema: z
    .object({
      newPassword: z.string().min(8, t("validation.passwordLength")),
      confirmPassword: z.string().min(8, t("validation.passwordLength")),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t("validation.passwordsMatch"),
      path: ["confirmPassword"],
    }),
});

export type PasswordFormData = z.infer<ReturnType<typeof createSchemas>["passwordSchema"]>;
export type ProfileFormData = z.infer<ReturnType<typeof createSchemas>["profileSchema"]>;

export function useProfile() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { profileSchema, passwordSchema } = createSchemas(t);

  const { setUser } = useAuth();
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
  });

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
  });

  // ── Query: load current user ──────────────────────────────────────
  const userQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: async () => {
      const response = await getCurrentUser();
      return response.data.user;
    },
  });

  const userData = userQuery.data ?? null;
  const isLoading = userQuery.isLoading;

  // Reset form when user data loads or changes
  useEffect(() => {
    if (userQuery.data) {
      profileForm.reset({
        firstName: userQuery.data.firstName,
        lastName: userQuery.data.lastName,
        username: userQuery.data.username,
        email: userQuery.data.email,
      });
    }
  }, [userQuery.data, profileForm]);

  // ── Mutation: update profile ──────────────────────────────────────
  const profileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof profileSchema>) => {
      await updateUser({
        id: userData!.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast.success(t("profile.messages.updateSuccess"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentUser() });
    },
    onError: () => {
      toast.error(t("profile.errors.updateFailed"));
    },
  });

  const onProfileSubmit = async (data: z.infer<typeof profileSchema>) => {
    const hasChanges =
      !userData ||
      Object.keys(data).some(
        (key) => data[key as keyof typeof data] !== userData[key as keyof User],
      );

    if (!hasChanges) {
      toast.info(t("profile.messages.noChanges"));
      return;
    }

    profileMutation.mutate(data);
  };

  // ── Mutation: update password ─────────────────────────────────────
  const passwordMutation = useMutation({
    mutationFn: async (data: z.infer<typeof passwordSchema>) => {
      await updateUser({
        id: userData!.id,
        password: data.newPassword,
      });
    },
    onSuccess: () => {
      toast.success(t("profile.messages.passwordSuccess"));
      passwordForm.reset();
    },
    onError: () => {
      toast.error(t("profile.errors.passwordFailed"));
    },
  });

  const onPasswordSubmit = async (data: z.infer<typeof passwordSchema>) => {
    if (!data.newPassword || !data.confirmPassword) {
      toast.info(t("profile.messages.fillPasswords"));
      return;
    }

    passwordMutation.mutate(data);
  };

  // ── Mutation: upload avatar ───────────────────────────────────────
  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const response = await uploadAvatar({ file });
      return response.data;
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(queryKeys.auth.currentUser(), updatedUser);
      setUser(updatedUser);
      toast.success(t("profile.messages.imageSuccess"));
    },
    onError: () => {
      toast.error(t("profile.errors.imageFailed"));
    },
  });

  const handleImageChange = async (file: File) => {
    if (!file || !userData?.id) return;
    uploadAvatarMutation.mutate(file);
  };

  // ── Mutation: remove avatar ───────────────────────────────────────
  const removeAvatarMutation = useMutation({
    mutationFn: async () => {
      const response = await removeAvatar();
      return response.data;
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(queryKeys.auth.currentUser(), updatedUser);
      setUser(updatedUser);
      toast.success(t("profile.messages.imageRemoved"));
    },
    onError: () => {
      toast.error(t("profile.errors.imageRemoveFailed"));
    },
  });

  const handleImageRemove = async () => {
    if (!userData?.id) return;
    removeAvatarMutation.mutate();
  };

  return {
    isLoading,
    userData,
    profileForm,
    passwordForm,
    isNewPasswordVisible,
    isConfirmPasswordVisible,
    setIsNewPasswordVisible,
    setIsConfirmPasswordVisible,
    onProfileSubmit,
    onPasswordSubmit,
    handleImageChange,
    handleImageRemove,
  };
}
