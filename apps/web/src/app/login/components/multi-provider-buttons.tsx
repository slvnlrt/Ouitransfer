"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { useAppInfo } from "@/contexts/app-info-context";
import type { EnabledAuthProvider } from "@/http/endpoints/auth/types";
import { useEnabledProviders } from "../hooks/use-enabled-providers";

interface MultiProviderButtonsProps {
  showSeparator?: boolean;
}

export function MultiProviderButtons({ showSeparator = true }: MultiProviderButtonsProps) {
  const t = useTranslations();
  const { firstAccess } = useAppInfo();
  const { data: providers = [], isLoading: loading } = useEnabledProviders({
    enabled: !firstAccess,
  });

  const handleProviderLogin = (provider: EnabledAuthProvider) => {
    if (!provider.authUrl) {
      toast.error(t("login.providerNotConfigured", { name: provider.displayName }));
      return;
    }

    window.location.href = provider.authUrl;
  };

  if (firstAccess) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-10 bg-muted animate-pulse rounded-md" />
      </div>
    );
  }

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showSeparator && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("login.orContinueWith")}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            className="w-full"
            onClick={() => handleProviderLogin(provider)}
            type="button"
          >
            <div className="flex items-center gap-2">
              {provider.icon && <DynamicIcon name={provider.icon} className="w-5 h-5" />}
              <span>{t("login.continueWith", { name: provider.displayName })}</span>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
