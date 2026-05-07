"use client";

import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { ErrorDisplay } from "@/components/error-display";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { Navbar } from "@/components/layout/navbar";
import { DefaultFooter } from "@/components/ui/default-footer";
import { SettingsForm } from "./components/settings-form";
import { SettingsHeader } from "./components/settings-header";
import { useSettings } from "./hooks/use-settings";

export default function SettingsPage() {
  const settings = useSettings();
  const t = useTranslations("errors");

  if (settings.isLoading) {
    return <LoadingScreen />;
  }

  if (settings.isUnauthorized) {
    return (
      <ProtectedRoute requireAdmin>
        <div className="w-full h-screen flex flex-col">
          <Navbar />
          <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
            <div className="flex flex-col gap-8 items-center justify-center min-h-[50vh]">
              <ErrorDisplay
                variant="card"
                title={t("accessDenied")}
                message={settings.error || t("accessDeniedMessage")}
                actions={[
                  {
                    label: t("refreshPage"),
                    onClick: () => window.location.reload(),
                    variant: "outline",
                  },
                ]}
              />
            </div>
          </div>
          <DefaultFooter />
        </div>
      </ProtectedRoute>
    );
  }

  if (settings.error && !settings.isUnauthorized) {
    return (
      <ProtectedRoute requireAdmin>
        <div className="w-full h-screen flex flex-col">
          <Navbar />
          <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
            <div className="flex flex-col gap-8 items-center justify-center min-h-[50vh]">
              <ErrorDisplay
                variant="card"
                title={t("errorLoadingSettings")}
                message={settings.error}
                actions={[
                  {
                    label: t("tryAgain"),
                    onClick: () => window.location.reload(),
                    variant: "outline",
                  },
                ]}
              />
            </div>
          </div>
          <DefaultFooter />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requireAdmin>
      <div className="w-full h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
          <div className="flex flex-col gap-8">
            <SettingsHeader />
            <SettingsForm
              collapsedGroups={settings.collapsedGroups}
              groupForms={settings.groupForms}
              groupedConfigs={settings.groupedConfigs}
              onGroupSubmit={settings.onGroupSubmit}
              onToggleCollapse={settings.toggleCollapse}
            />
          </div>
        </div>
        <DefaultFooter />
      </div>
    </ProtectedRoute>
  );
}
