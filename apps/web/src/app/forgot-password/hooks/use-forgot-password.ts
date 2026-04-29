"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { getAuthConfig, requestPasswordReset } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";

export type ForgotPasswordFormData = {
  email: string;
};

export function useForgotPassword() {
  const t = useTranslations();
  const router = useRouter();

  const forgotPasswordSchema = z.object({
    email: z.string().email(t("validation.invalidEmail")),
  });

  const authConfigQuery = useQuery({
    queryKey: queryKeys.auth.config(),
    queryFn: async () => {
      const response = await getAuthConfig();
      return response.data;
    },
  });

  const passwordAuthEnabled = authConfigQuery.data?.passwordAuthEnabled ?? true;
  const authConfigLoading = authConfigQuery.isLoading;

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    if (!passwordAuthEnabled) {
      toast.error(t("errors.passwordAuthDisabled"));
      return;
    }

    try {
      await requestPasswordReset({
        email: data.email,
        origin: window.location.origin,
      });
      toast.success(t("forgotPassword.resetInstructions"));
      router.push("/login");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        toast.error(t(err.response.data.message));
      } else {
        toast.error(t("common.unexpectedError"));
      }
    }
  };

  return {
    form,
    onSubmit,
    passwordAuthEnabled,
    authConfigLoading,
  };
}
