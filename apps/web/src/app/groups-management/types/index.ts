import type { UseFormReturn } from "react-hook-form";

import type { GroupDetail, GroupListItem } from "@/http/endpoints/groups/types";
import type { GroupFormData } from "../hooks/use-group-management";

export interface GroupActionsDropdownProps {
  group: GroupListItem;
  onEdit: (group: GroupListItem) => void;
  onDelete: (group: GroupListItem) => void;
  onViewDetails: (group: GroupListItem) => void;
}

export interface GroupDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: GroupListItem | null;
  onConfirm: () => Promise<void>;
}

export interface GroupFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalMode: "create" | "edit";
  selectedGroup: GroupListItem | null;
  formMethods: UseFormReturn<GroupFormData>;
  onSubmit: (
    data: GroupFormData & {
      maxFileSizeOverride?: string | number | null;
      maxTotalStorageOverride?: string | number | null;
    },
  ) => Promise<void>;
}

export interface GroupDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: GroupDetail | null;
  isLoading: boolean;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
}

export interface GroupManagementModalsProps {
  modals: {
    isOpen: boolean;
    onClose: () => void;
    modalMode: "create" | "edit";
    isDeleteModalOpen: boolean;
    onDeleteModalClose: () => void;
    isDetailModalOpen: boolean;
    onDetailModalClose: () => void;
  };
  selectedGroup: GroupListItem | null;
  deleteModalGroup: GroupListItem | null;
  detailGroup: GroupDetail | null;
  isDetailLoading: boolean;
  onSubmit: (
    data: GroupFormData & {
      maxFileSizeOverride?: string | number | null;
      maxTotalStorageOverride?: string | number | null;
    },
  ) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
  formMethods: UseFormReturn<GroupFormData>;
}

export interface GroupsHeaderProps {
  onCreateGroup: () => void;
}

export interface GroupsTableProps {
  groups: GroupListItem[];
  onEdit: (group: GroupListItem) => void;
  onDelete: (group: GroupListItem) => void;
  onViewDetails: (group: GroupListItem) => void;
}
