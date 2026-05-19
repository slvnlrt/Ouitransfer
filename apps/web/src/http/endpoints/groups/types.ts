import type { AxiosResponse } from "axios";

export interface GroupListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  storageUsed: string;
  maxFileSizeOverride: string | null;
  maxTotalStorageOverride: string | null;
  ldapDn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  image: string | null;
  storageUsed: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  maxFileSizeOverride: string | null;
  maxTotalStorageOverride: string | null;
  ldapDn: string | null;
  createdAt: string;
  updatedAt: string;
  members: GroupMember[];
}

export interface CreateGroupBody {
  name: string;
  description?: string;
  maxFileSizeOverride?: string | number | null;
  maxTotalStorageOverride?: string | number | null;
}

export interface UpdateGroupBody {
  name?: string;
  description?: string | null;
  maxFileSizeOverride?: string | number | null;
  maxTotalStorageOverride?: string | number | null;
}

export interface AddMemberBody {
  userId: string;
}

export interface AddMemberResponse {
  message: string;
  previousGroupId: string | null;
}

export interface DeleteGroupResponse {
  message: string;
  unassignedCount: number;
}

export interface MessageResponse {
  message: string;
}

export type ListGroupsResult = AxiosResponse<GroupListItem[]>;
export type GetGroupResult = AxiosResponse<GroupDetail>;
export type CreateGroupResult = AxiosResponse<GroupListItem>;
export type UpdateGroupResult = AxiosResponse<GroupListItem>;
export type DeleteGroupResult = AxiosResponse<DeleteGroupResponse>;
export type AddMemberResult = AxiosResponse<AddMemberResponse>;
export type RemoveMemberResult = AxiosResponse<MessageResponse>;
