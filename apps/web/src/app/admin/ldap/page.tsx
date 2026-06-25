"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { UserManagementTabs } from "@/app/admin/components/user-management-tabs";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { LdapConfigForm } from "./components/ldap-config-form";
import { LdapGroupMapping } from "./components/ldap-group-mapping";
import { LdapHeader } from "./components/ldap-header";
import { LdapSyncDetailModal } from "./components/ldap-sync-detail-modal";
import { LdapSyncOperations } from "./components/ldap-sync-operations";
import { useLdapConfig } from "./hooks/use-ldap-config";
import { useLdapSync } from "./hooks/use-ldap-sync";

export default function LdapPage() {
  const t = useTranslations();
  const {
    config,
    isLoading: isLoadingConfig,
    formMethods,
    isSaving,
    onSave,
    isTesting,
    testResult,
    onTest,
    mappedGroups,
    isLoadingGroups,
  } = useLdapConfig();

  const {
    status,
    logs,
    totalLogs,
    isLoadingLogs,
    isSyncing,
    onSync,
    selectedLog,
    isDetailOpen,
    onViewDetail,
    onCloseDetail,
    page,
    onPageChange,
  } = useLdapSync();

  if (isLoadingConfig) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute requireAdmin>
      <PageLayout>
        <div className="flex flex-col gap-8">
          <UserManagementTabs />
          <LdapHeader />
          {/* Server-side warnings (e.g., missing ENCRYPTION_SECRET for bind password encryption) */}
          {status?.warnings && status.warnings.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {t("ldap.warnings.title")}
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {status.warnings.map((warning) => (
                    <li key={warning} className="text-sm text-amber-700 dark:text-amber-400">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="space-y-6">
            <LdapConfigForm
              isSaving={isSaving}
              isTesting={isTesting}
              testResult={testResult}
              formMethods={formMethods}
              onSave={onSave}
              onTest={onTest}
              configSaved={config?.configured ?? false}
            />

            <LdapGroupMapping groups={mappedGroups} isLoading={isLoadingGroups} />

            <LdapSyncOperations
              status={status}
              logs={logs}
              totalLogs={totalLogs}
              isLoading={isLoadingLogs}
              isSyncing={isSyncing}
              onSync={onSync}
              onViewDetail={onViewDetail}
              page={page}
              onPageChange={onPageChange}
            />

            <LdapSyncDetailModal log={selectedLog} isOpen={isDetailOpen} onClose={onCloseDetail} />
          </div>
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
