"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackgroundLights } from "@/components/ui/background-lights";
import { DefaultFooter } from "@/components/ui/default-footer";
import { Spinner } from "@/components/ui/spinner";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import { ForgotPasswordHeader } from "./components/forgot-password-header";
import { useForgotPassword } from "./hooks/use-forgot-password";

export default function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const t = useTranslations("ForgotPassword");

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
            <ForgotPasswordHeader />
            {forgotPassword.authConfigLoading ? (
              <div className="flex justify-center items-center py-8">
                <Spinner size="lg" />
              </div>
            ) : !forgotPassword.passwordAuthEnabled ? (
              <div className="mt-8 space-y-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <p className="text-muted-foreground">
                    {t("forgotPassword.passwordAuthDisabled")}
                  </p>
                </div>
                <div className="text-center">
                  <Link className="text-muted-foreground hover:text-primary text-sm" href="/login">
                    {t("forgotPassword.backToLogin")}
                  </Link>
                </div>
              </div>
            ) : (
              <ForgotPasswordForm form={forgotPassword.form} onSubmit={forgotPassword.onSubmit} />
            )}
          </motion.div>
        </div>
      </div>
      <DefaultFooter />
    </div>
  );
}
