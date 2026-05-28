import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AddFilesBody,
  AddFilesResult,
  AddFoldersResult,
  AddRecipientsBody,
  AddRecipientsResult,
  CreateShareAliasBody,
  CreateShareAliasResult,
  CreateShareBody,
  CreateShareResult,
  DeleteShareResult,
  GetShareByAliasParams,
  GetShareByAliasResult,
  GetShareMetadataResult,
  GetShareParams,
  GetShareResult,
  GetShareVisitsResult,
  IdentifyVisitorBody,
  IdentifyVisitorResult,
  ListUserSharesResult,
  NotifyRecipientsBody,
  NotifyRecipientsResult,
  RemoveFilesBody,
  RemoveFilesResult,
  RemoveFoldersResult,
  RemoveRecipientsBody,
  RemoveRecipientsResult,
  UpdateShareBody,
  UpdateSharePasswordBody,
  UpdateSharePasswordResult,
  UpdateShareResult,
} from "./types";

/**
 * Share management endpoints.
 * Aligned directly to actual backend REST routes.
 */

/**
 * Create a new share
 * @summary Create a new share
 */
export const createShare = (
  createShareBody: CreateShareBody,
  options?: AxiosRequestConfig,
): Promise<CreateShareResult> => {
  return apiInstance.post(`/api/shares`, createShareBody, options);
};

/**
 * Update a share
 * @summary Update a share
 */
export const updateShare = (
  updateShareBody: UpdateShareBody,
  options?: AxiosRequestConfig,
): Promise<UpdateShareResult> => {
  return apiInstance.put(`/api/shares`, updateShareBody, options);
};

/**
 * List all shares created by the authenticated user
 * @summary List all shares created by the authenticated user
 */
export const listUserShares = (options?: AxiosRequestConfig): Promise<ListUserSharesResult> => {
  return apiInstance.get(`/api/shares/me`, options);
};

/**
 * Get a share by ID (no password)
 * @summary Get a share by ID
 */
export const getShare = (
  shareId: string,
  params?: GetShareParams,
  options?: AxiosRequestConfig,
): Promise<GetShareResult> => {
  if (params?.password) {
    // Password-protected shares use the POST /access endpoint
    return apiInstance.post(
      `/api/shares/${shareId}/access`,
      { password: params.password },
      options,
    );
  }
  return apiInstance.get(`/api/shares/${shareId}`, options);
};

/**
 * Delete a share
 * @summary Delete a share
 */
export const deleteShare = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteShareResult> => {
  return apiInstance.delete(`/api/shares/${id}`, options);
};

/**
 * @summary Update share password
 */
export const updateSharePassword = (
  shareId: string,
  updateSharePasswordBody: UpdateSharePasswordBody,
  options?: AxiosRequestConfig,
): Promise<UpdateSharePasswordResult> => {
  return apiInstance.put(`/api/shares/${shareId}/password`, updateSharePasswordBody, options);
};

/**
 * @summary Add files to share
 */
export const addFiles = (
  shareId: string,
  addFilesBody: AddFilesBody,
  options?: AxiosRequestConfig,
): Promise<AddFilesResult> => {
  return apiInstance.post(
    `/api/shares/${shareId}/items`,
    { files: addFilesBody.files, folders: [] },
    options,
  );
};

/**
 * @summary Remove files from share
 */
export const removeFiles = (
  shareId: string,
  removeFilesBody: RemoveFilesBody,
  options?: AxiosRequestConfig,
): Promise<RemoveFilesResult> => {
  return apiInstance.delete(`/api/shares/${shareId}/items`, {
    data: { files: removeFilesBody.files, folders: [] },
    ...options,
  });
};

/**
 * @summary Add recipients to a share
 */
export const addRecipients = (
  shareId: string,
  addRecipientsBody: AddRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<AddRecipientsResult> => {
  return apiInstance.post(`/api/shares/${shareId}/recipients`, addRecipientsBody, options);
};

/**
 * Remove recipients from a share
 * @summary Remove recipients from a share
 */
export const removeRecipients = (
  shareId: string,
  removeRecipientsBody: RemoveRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<RemoveRecipientsResult> => {
  return apiInstance.delete(`/api/shares/${shareId}/recipients`, {
    data: removeRecipientsBody,
    ...options,
  });
};

/**
 * @summary Create or update share alias
 */
export const createShareAlias = (
  shareId: string,
  createShareAliasBody: CreateShareAliasBody,
  options?: AxiosRequestConfig,
): Promise<CreateShareAliasResult> => {
  return apiInstance.post(`/api/shares/${shareId}/alias`, createShareAliasBody, options);
};

/**
 * @summary Get share by alias
 */
export const getShareByAlias = (
  alias: string,
  params?: GetShareByAliasParams,
  options?: AxiosRequestConfig,
): Promise<GetShareByAliasResult> => {
  if (params?.password) {
    // Password-protected shares use the POST /access endpoint
    return apiInstance.post(
      `/api/shares/alias/${alias}/access`,
      { password: params.password },
      options,
    );
  }
  return apiInstance.get(`/api/shares/alias/${alias}`, options);
};

/**
 * Send email notification with share link to all recipients
 * @summary Send email notification to share recipients
 */
export const notifyRecipients = (
  shareId: string,
  notifyRecipientsBody: NotifyRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<NotifyRecipientsResult> => {
  return apiInstance.post(`/api/shares/${shareId}/notify`, notifyRecipientsBody, options);
};

/**
 * @summary Add folders to share
 */
export const addFolders = (
  shareId: string,
  addFoldersBody: { folders: string[] },
  options?: AxiosRequestConfig,
): Promise<AddFoldersResult> => {
  return apiInstance.post(
    `/api/shares/${shareId}/items`,
    { files: [], folders: addFoldersBody.folders },
    options,
  );
};

/**
 * @summary Remove folders from share
 */
export const removeFolders = (
  shareId: string,
  removeFoldersBody: { folders: string[] },
  options?: AxiosRequestConfig,
): Promise<RemoveFoldersResult> => {
  return apiInstance.delete(`/api/shares/${shareId}/items`, {
    data: { files: [], folders: removeFoldersBody.folders },
    ...options,
  });
};

/**
 * Get share visit history (creator only)
 */
export const getShareVisits = (
  shareId: string,
  params?: { action?: string; page?: number; limit?: number },
  options?: AxiosRequestConfig,
): Promise<GetShareVisitsResult> => {
  return apiInstance.get(`/api/shares/${shareId}/visits`, { params, ...options });
};

/**
 * Identify a visitor on a share (public, sets httpOnly cookie)
 */
export const identifyVisitor = (
  alias: string,
  body: IdentifyVisitorBody,
  options?: AxiosRequestConfig,
): Promise<IdentifyVisitorResult> => {
  return apiInstance.post(`/api/shares/alias/${alias}/identify`, body, options);
};

/**
 * Get share metadata by alias (public, lightweight)
 */
export const getShareMetadata = (
  alias: string,
  options?: AxiosRequestConfig,
): Promise<GetShareMetadataResult> => {
  return apiInstance.get(`/api/shares/alias/${alias}/metadata`, options);
};
