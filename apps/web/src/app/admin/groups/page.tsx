"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { PageLayout } from "@/components/layout/page-layout";
import { GroupManagementModals } from "./components/group-management-modals";
import { GroupsHeader } from "./components/groups-header";
import { GroupsTable } from "./components/groups-table";
import { useGroupManagement } from "./hooks/use-group-management";

export default function GroupsManagementPage() {
  const {
    groups,
    isLoading,
    selectedGroup,
    deleteModalGroup,
    detailGroup,
    isDetailLoading,
    modals,
    handleCreateGroup,
    handleEditGroup,
    handleViewDetails,
    handleDeleteGroup,
    handleAddMember,
    handleRemoveMember,
    onSubmit,
    formMethods,
  } = useGroupManagement();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute requireAdmin>
      <PageLayout>
        <div className="flex flex-col gap-8">
          <GroupsHeader onCreateGroup={handleCreateGroup} />
          <GroupsTable
            groups={groups}
            onEdit={handleEditGroup}
            onDelete={(group) => {
              modals.setDeleteModalGroup(group);
              modals.onDeleteModalOpen();
            }}
            onViewDetails={handleViewDetails}
          />
        </div>
        <GroupManagementModals
          deleteModalGroup={deleteModalGroup}
          detailGroup={detailGroup}
          formMethods={formMethods}
          isDetailLoading={isDetailLoading}
          modals={modals}
          selectedGroup={selectedGroup}
          onAddMember={handleAddMember}
          onDelete={handleDeleteGroup}
          onRemoveMember={handleRemoveMember}
          onSubmit={onSubmit}
        />
      </PageLayout>
    </ProtectedRoute>
  );
}
