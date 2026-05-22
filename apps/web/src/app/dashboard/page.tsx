"use client";

import { LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { FileManagerLayout } from "@/components/layout/file-manager-layout";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { QuickAccessCards } from "./components/quick-access-cards";
import { QuickShare } from "./components/quick-share/quick-share";
import { RecentFiles } from "./components/recent-files";
import { RecentShares } from "./components/recent-shares";
import { SystemStatus } from "./components/system-status";
import { useDashboard } from "./hooks/use-dashboard";
import { DashboardModals } from "./modals/dashboard-modals";

export default function DashboardPage() {
  const t = useTranslations();

  const {
    isLoading,
    recentFiles,
    recentShares,
    totalFileCount,
    totalShareCount,
    modals,
    fileManager,
    shareManager,
    handleCopyLink,
    loadDashboardData,
    smtpEnabled,
  } = useDashboard();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute>
      <FileManagerLayout
        breadcrumbLabel={t("dashboard.breadcrumb")}
        icon={<LayoutDashboard className="text-xl" />}
        showBreadcrumb={false}
        title={t("dashboard.pageTitle")}
      >
        <QuickShare onShareCreated={loadDashboardData} smtpEnabled={smtpEnabled} />
        <SystemStatus fileCount={totalFileCount} activeShareCount={totalShareCount} />
        <QuickAccessCards />

        <div className="flex flex-col gap-6">
          <RecentFiles
            fileManager={fileManager}
            files={recentFiles}
            isUploadModalOpen={modals.isUploadModalOpen}
            onOpenUploadModal={modals.onOpenUploadModal}
          />

          <RecentShares
            isCreateModalOpen={modals.isCreateModalOpen}
            shareManager={shareManager}
            shares={recentShares}
            onCopyLink={handleCopyLink}
            onOpenCreateModal={modals.onOpenCreateModal}
          />
        </div>

        <DashboardModals
          fileManager={fileManager}
          modals={modals}
          shareManager={shareManager}
          onSuccess={loadDashboardData}
        />
      </FileManagerLayout>
    </ProtectedRoute>
  );
}
