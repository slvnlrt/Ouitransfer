"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/general/language-switcher";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { BackgroundLights } from "@/components/ui/background-lights";
import { Button } from "@/components/ui/button";
import { DefaultFooter } from "@/components/ui/default-footer";
import { validateInviteToken } from "@/http/endpoints/invite";
import { queryKeys } from "@/lib/query-keys";
import { RegisterForm } from "./components/register-form";

interface TokenValidation {
  valid: boolean;
  error: string | null;
}

export default function RegisterWithInvitePage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const tokenQuery = useQuery<TokenValidation>({
    queryKey: queryKeys.invite.validate(token),
    queryFn: async () => {
      const response = await validateInviteToken(token);
      if (!response.valid) {
        if (response.used) {
          return { valid: false, error: t("registerWithInvite.errors.tokenUsed") };
        }
        if (response.expired) {
          return { valid: false, error: t("registerWithInvite.errors.tokenExpired") };
        }
        return { valid: false, error: t("registerWithInvite.errors.invalidToken") };
      }
      return { valid: true, error: null };
    },
    enabled: !!token,
    retry: false,
  });

  const isValidating = tokenQuery.isLoading;
  const tokenValid = tokenQuery.data?.valid ?? false;
  const tokenError =
    tokenQuery.data?.error ??
    (tokenQuery.error ? t("registerWithInvite.errors.invalidToken") : null);

  const handleRegistrationSuccess = () => {
    setTimeout(() => {
      router.push("/login");
    }, 2000);
  };

  if (isValidating) {
    return <LoadingScreen />;
  }

  if (!tokenValid) {
    return (
      <div className="relative flex flex-col min-h-screen">
        <div className="fixed top-4 end-4 z-50">
          <LanguageSwitcher />
        </div>
        <div className="container mx-auto max-w-7xl px-6 flex-grow">
          <BackgroundLights />
          <div className="relative flex h-full w-full items-center justify-center">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-card/90 backdrop-blur-sm px-8 pb-10 pt-6 shadow-xl border border-border/60"
              initial={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.5 }}
            >
              <div className="text-center">
                <h1 className="text-2xl font-bold mb-2">
                  {t("registerWithInvite.errors.invalidToken")}
                </h1>
                <p className="text-muted-foreground mb-4">{tokenError}</p>
                <Button onClick={() => router.push("/login")}>
                  {t("forgotPassword.backToLogin")}
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
        <DefaultFooter />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen">
      <div className="fixed top-4 end-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="container mx-auto max-w-7xl px-6 flex-grow">
        <BackgroundLights />
        <div className="relative flex h-full w-full items-center justify-center">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full max-w-md flex-col gap-6 rounded-xl bg-card/90 backdrop-blur-sm px-8 pb-10 pt-6 shadow-xl border border-border/60"
            initial={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.5 }}
          >
            <div className="text-center">
              <h1 className="text-2xl font-bold">{t("registerWithInvite.title")}</h1>
              <p className="text-muted-foreground text-sm mt-2">
                {t("registerWithInvite.description")}
              </p>
            </div>

            <RegisterForm token={token} onSuccess={handleRegistrationSuccess} />
          </motion.div>
        </div>
      </div>
      <DefaultFooter />
    </div>
  );
}
