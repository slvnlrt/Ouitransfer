"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { BackgroundLights } from "@/components/ui/background-lights";
import { DefaultFooter } from "@/components/ui/default-footer";
import { ResetPasswordForm } from "./components/reset-password-form";
import { ResetPasswordHeader } from "./components/reset-password-header";
import { useResetPassword } from "./hooks/use-reset-password";

export default function ResetPasswordPage() {
  const t = useTranslations();

  const router = useRouter();
  const resetPassword = useResetPassword();

  useEffect(() => {
    if (!resetPassword.token) {
      toast.error(t("resetPassword.errors.invalidToken"));
      router.push("/login");
    }
  }, [resetPassword.token, router, t]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center">
        <BackgroundLights />
        <div className="relative z-10 w-full max-w-md space-y-4 px-4 py-12">
          <div
            aria-hidden
            className="absolute inset-x-7 inset-y-9 -z-10 rounded-3xl bg-gradient-brand opacity-[0.12] blur-2xl"
          />
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="relative space-y-6 overflow-hidden rounded-xl border border-border/60 bg-card/90 backdrop-blur-sm p-8 shadow-xl"
            initial={{ opacity: 0, y: 20 }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 bg-grid-fade opacity-50"
            />
            <ResetPasswordHeader />
            <ResetPasswordForm
              form={resetPassword.form}
              isConfirmPasswordVisible={resetPassword.isConfirmPasswordVisible}
              isPasswordVisible={resetPassword.isPasswordVisible}
              onSubmit={resetPassword.onSubmit}
              onToggleConfirmPassword={() =>
                resetPassword.setIsConfirmPasswordVisible(!resetPassword.isConfirmPasswordVisible)
              }
              onTogglePassword={() =>
                resetPassword.setIsPasswordVisible(!resetPassword.isPasswordVisible)
              }
            />
          </motion.div>
        </div>
      </div>
      <DefaultFooter />
    </div>
  );
}
