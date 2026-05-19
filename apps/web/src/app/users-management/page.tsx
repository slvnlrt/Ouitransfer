"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { getLdapStatus, triggerLdapSync } from "@/http/endpoints/ldap";
import { queryKeys } from "@/lib/query-keys";
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
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      toast.error(t("ldap.sync.error"));
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
                  {t("ldap.sync.lastSync")}:{" "}
                  {new Date(ldapStatus.lastSync.startedAt).toLocaleString()}
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
