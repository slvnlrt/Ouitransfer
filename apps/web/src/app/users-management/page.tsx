"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { getLdapStatus, triggerLdapSync } from "@/http/endpoints/ldap";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import { formatRelativeTime } from "@/utils/format-relative-time";
import { GenerateInviteLinkModal } from "./components/generate-invite-link-modal";
import { UserManagementModals } from "./components/user-management-modals";
import { UsersHeader } from "./components/users-header";
import { UsersTable } from "./components/users-table";
import { useUserManagement } from "./hooks/use-user-management";

export default function AdminAreaPage() {
  const t = useTranslations();
  const {
    users,
    isLoading,
    currentUser,
    modals,
    selectedUser,
    deleteModalUser,
    statusModalUser,
    handleCreateUser,
    handleEditUser,
    handleDeleteUser,
    handleToggleUserStatus,
    onSubmit,
    formMethods,
  } = useUserManagement();

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const queryClient = useQueryClient();
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const ldapStatusQuery = useQuery({
    queryKey: queryKeys.ldap.status(),
    queryFn: async () => {
      const res = await getLdapStatus();
      return res.data;
    },
  });
  const ldapStatus = ldapStatusQuery.data;

  const syncMutation = useMutation({
    mutationFn: () => triggerLdapSync(),
    onSuccess: () => {
      toast.success(t("ldap.sync.triggered"));
      queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });

      // I-4: Poll for sync completion, then refresh user list
      stopPolling();
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await getLdapStatus();
          if (!res.data.syncInProgress) {
            stopPolling();
            queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });
          }
        } catch {
          stopPolling();
        }
      }, 3000);
      pollTimeoutRef.current = setTimeout(() => stopPolling(), 5 * 60 * 1000);
    },
    onError: (error: unknown) => {
      const apiError = parseApiError(error);
      toast.error(apiError.message || t("ldap.sync.error"));
    },
  });

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute requireAdmin>
      <PageLayout>
        <div className="flex flex-col gap-8">
          <UsersHeader
            onCreateUser={handleCreateUser}
            onGenerateInvite={() => setIsInviteModalOpen(true)}
          />

          {ldapStatus?.configured && ldapStatus.enabled && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              {ldapStatus.lastSync ? (
                <span className="text-sm text-muted-foreground">
                  {t("ldap.sync.lastSync")}: {formatRelativeTime(ldapStatus.lastSync.startedAt, t)}
                  {" — "}
                  {ldapStatus.lastSync.usersCreated} {t("ldap.sync.created").toLowerCase()},{" "}
                  {ldapStatus.lastSync.usersUpdated} {t("ldap.sync.updated").toLowerCase()}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{t("ldap.sync.noHistory")}</span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || ldapStatus.syncInProgress}
              >
                {(syncMutation.isPending || ldapStatus.syncInProgress) && (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                )}
                {t("ldap.sync.syncNow")}
              </Button>
            </div>
          )}

          <UsersTable
            currentUser={currentUser}
            users={users}
            onDelete={(user) => {
              modals.setDeleteModalUser(user);
              modals.onDeleteModalOpen();
            }}
            onEdit={handleEditUser}
            onToggleStatus={(user) => {
              modals.setStatusModalUser(user);
              modals.onStatusModalOpen();
            }}
          />
        </div>

        <UserManagementModals
          deleteModalUser={deleteModalUser}
          formMethods={formMethods}
          modals={modals}
          selectedUser={selectedUser}
          statusModalUser={statusModalUser}
          onDelete={handleDeleteUser}
          onSubmit={onSubmit}
          onToggleStatus={handleToggleUserStatus}
        />

        <GenerateInviteLinkModal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
        />
      </PageLayout>
    </ProtectedRoute>
  );
}
