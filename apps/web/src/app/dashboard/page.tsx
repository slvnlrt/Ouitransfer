"use client";

import { LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { GlobalDropZone } from "@/components/general/global-drop-zone";
import { FileManagerLayout } from "@/components/layout/file-manager-layout";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { useAuth } from "@/contexts/auth-context";
import { QuickAccessCards } from "./components/quick-access-cards";
import { RecentFiles } from "./components/recent-files";
import { RecentShares } from "./components/recent-shares";
import { StorageUsage } from "./components/storage-usage";
import { SystemHealth } from "./components/system-health";
import { useDashboard } from "./hooks/use-dashboard";
import { DashboardModals } from "./modals/dashboard-modals";

export default function DashboardPage() {
  const t = useTranslations();
  const { isAdmin } = useAuth();

  const {
    isLoading,
    diskSpace,
    diskSpaceError,
    healthData,
    healthError,
    recentFiles,
    recentShares,
    modals,
    fileManager,
    shareManager,
    handleCopyLink,
    loadDashboardData,
  } = useDashboard();

  if (isLoading) {
    return <LoadingScreen />;
  }

  const handleRetryDiskSpace = async () => {
    await loadDashboardData();
  };

  return (
    <ProtectedRoute>
      <GlobalDropZone onSuccess={loadDashboardData}>
        <FileManagerLayout
          breadcrumbLabel={t("dashboard.breadcrumb")}
          icon={<LayoutDashboard className="text-xl" />}
          showBreadcrumb={false}
          title={t("dashboard.pageTitle")}
        >
          <div className={isAdmin ? "grid grid-cols-1 gap-6 md:grid-cols-2" : undefined}>
            <StorageUsage
              diskSpace={diskSpace}
              diskSpaceError={diskSpaceError}
              onRetry={handleRetryDiskSpace}
            />
            {isAdmin && <SystemHealth healthData={healthData} healthError={healthError} />}
          </div>
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
      </GlobalDropZone>
    </ProtectedRoute>
  );
}
