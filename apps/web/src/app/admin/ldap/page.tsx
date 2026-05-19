"use client";

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
  const {
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
          <LdapHeader />
          <div className="space-y-6">
            <LdapConfigForm
              isSaving={isSaving}
              isTesting={isTesting}
              testResult={testResult}
              formMethods={formMethods}
              onSave={onSave}
              onTest={onTest}
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
