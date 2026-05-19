import type { GroupManagementModalsProps } from "../types";
import { GroupDeleteModal } from "./group-delete-modal";
import { GroupDetailModal } from "./group-detail-modal";
import { GroupFormModal } from "./group-form-modal";

export function GroupManagementModals({
  modals,
  selectedGroup,
  deleteModalGroup,
  detailGroup,
  isDetailLoading,
  onSubmit,
  onDelete,
  onAddMember,
  onRemoveMember,
  formMethods,
}: GroupManagementModalsProps) {
  return (
    <>
      <GroupFormModal
        formMethods={formMethods}
        isOpen={modals.isOpen}
        modalMode={modals.modalMode}
        selectedGroup={selectedGroup}
        onClose={modals.onClose}
        onSubmit={onSubmit}
      />

      <GroupDeleteModal
        group={deleteModalGroup}
        isOpen={modals.isDeleteModalOpen}
        onClose={modals.onDeleteModalClose}
        onConfirm={onDelete}
      />

      <GroupDetailModal
        group={detailGroup}
        isLoading={isDetailLoading}
        isOpen={modals.isDetailModalOpen}
        onAddMember={onAddMember}
        onClose={modals.onDetailModalClose}
        onRemoveMember={onRemoveMember}
      />
    </>
  );
}
