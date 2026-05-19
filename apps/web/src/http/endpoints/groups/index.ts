import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AddMemberBody,
  AddMemberResult,
  CreateGroupBody,
  CreateGroupResult,
  DeleteGroupResult,
  GetGroupResult,
  ListGroupsResult,
  RemoveMemberResult,
  UpdateGroupBody,
  UpdateGroupResult,
} from "./types";

/** List all groups (admin only) */
export const listGroups = (options?: AxiosRequestConfig): Promise<ListGroupsResult> => {
  return apiInstance.get("/api/groups/list", options);
};

/** Get group details with members (admin only) */
export const getGroup = (id: string, options?: AxiosRequestConfig): Promise<GetGroupResult> => {
  return apiInstance.get(`/api/groups/details/${id}`, options);
};

/** Create a new group (admin only) */
export const createGroup = (
  body: CreateGroupBody,
  options?: AxiosRequestConfig,
): Promise<CreateGroupResult> => {
  return apiInstance.post("/api/groups/create", body, options);
};

/** Update a group (admin only) */
export const updateGroup = (
  id: string,
  body: UpdateGroupBody,
  options?: AxiosRequestConfig,
): Promise<UpdateGroupResult> => {
  return apiInstance.put(`/api/groups/update/${id}`, body, options);
};

/** Delete a group (admin only) */
export const deleteGroup = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteGroupResult> => {
  return apiInstance.delete(`/api/groups/delete/${id}`, options);
};

/** Add a member to a group (admin only) */
export const addGroupMember = (
  groupId: string,
  body: AddMemberBody,
  options?: AxiosRequestConfig,
): Promise<AddMemberResult> => {
  return apiInstance.post(`/api/groups/${groupId}/members/add`, body, options);
};

/** Remove a member from a group (admin only) */
export const removeGroupMember = (
  groupId: string,
  userId: string,
  options?: AxiosRequestConfig,
): Promise<RemoveMemberResult> => {
  return apiInstance.delete(`/api/groups/${groupId}/members/remove/${userId}`, options);
};
