"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { resetPassword } from "@/http/endpoints";
import { createPasswordPolicySchema } from "@/lib/password-policy";
import { parseApiError } from "@/utils/api-error";

const createSchema = (t: (key: string) => string) => {
  const passwordSchema = createPasswordPolicySchema({
    minLength: t("validation.passwordLength"),
    maxLength: t("validation.passwordMaxLength"),
    complexity: t("validation.passwordComplexity"),
  });
  return z
    .object({
      password: passwordSchema,
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordsMatch"),
      path: ["confirmPassword"],
    });
};

export type ResetPasswordFormData = z.infer<ReturnType<typeof createSchema>>;

export function useResetPassword() {
  const t = useTranslations();
  const schema = createSchema(t);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) return;

    try {
      await resetPassword({
        token,
        password: data.password,
      });

      toast.success(t("resetPassword.messages.success"));
      router.push("/login");
    } catch (err) {
      const apiError = parseApiError(err);
      if (apiError.isNetworkError) {
        toast.error(t("errors.networkError"));
      } else if (apiError.statusCode > 0) {
        toast.error(t("resetPassword.errors.serverError"));
      } else {
        toast.error(t("common.unexpectedError"));
      }
    }
  };

  return {
    token,
    form,
    isPasswordVisible,
    isConfirmPasswordVisible,
    setIsPasswordVisible,
    setIsConfirmPasswordVisible,
    onSubmit,
  };
}
