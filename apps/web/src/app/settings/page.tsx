"use client";

import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { ErrorDisplay } from "@/components/error-display";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
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
        <PageLayout>
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
        </PageLayout>
      </ProtectedRoute>
    );
  }

  if (settings.error && !settings.isUnauthorized) {
    return (
      <ProtectedRoute requireAdmin>
        <PageLayout>
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
        </PageLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requireAdmin>
      <PageLayout>
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
      </PageLayout>
    </ProtectedRoute>
  );
}
