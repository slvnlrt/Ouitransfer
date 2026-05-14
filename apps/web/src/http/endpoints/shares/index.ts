import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AddFilesBody,
  AddFilesResult,
  AddRecipientsBody,
  AddRecipientsResult,
  CreateShareAliasBody,
  CreateShareAliasResult,
  CreateShareBody,
  CreateShareResult,
  DeleteShareResult,
  GetShareByAliasParams,
  GetShareByAliasResult,
  GetShareParams,
  GetShareResult,
  ListUserSharesResult,
  NotifyRecipientsBody,
  NotifyRecipientsResult,
  RemoveFilesBody,
  RemoveFilesResult,
  RemoveRecipientsBody,
  RemoveRecipientsResult,
  UpdateShareBody,
  UpdateSharePasswordBody,
  UpdateSharePasswordResult,
  UpdateShareResult,
} from "./types";

/**
 * Create a new share
 * @summary Create a new share
 */
export const createShare = <TData = CreateShareResult>(
  createShareBody: CreateShareBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/shares/create`, createShareBody, options);
};

/**
 * Update a share
 * @summary Update a share
 */
export const updateShare = <TData = UpdateShareResult>(
  updateShareBody: UpdateShareBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.put(`/api/shares/update`, updateShareBody, options);
};

/**
 * List all shares created by the authenticated user
 * @summary List all shares created by the authenticated user
 */
export const listUserShares = <TData = ListUserSharesResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get(`/api/shares/list`, options);
};

/**
 * Get a share by ID (no password)
 * @summary Get a share by ID
 */
export const getShare = <TData = GetShareResult>(
  shareId: string,
  params?: GetShareParams,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  if (params?.password) {
    // Password-protected shares use the POST /access endpoint
    return apiInstance.post(
      `/api/shares/${shareId}/access`,
      { password: params.password },
      options,
    );
  }
  return apiInstance.get(`/api/shares/details/${shareId}`, options);
};

/**
 * Delete a share
 * @summary Delete a share
 */
export const deleteShare = <TData = DeleteShareResult>(
  id: string,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/shares/delete/${id}`, options);
};

/**
 * @summary Update share password
 */
export const updateSharePassword = <TData = UpdateSharePasswordResult>(
  shareId: string,
  updateSharePasswordBody: UpdateSharePasswordBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.patch(
    `api/shares/password/update/${shareId}`,
    updateSharePasswordBody,
    options,
  );
};

/**
 * @summary Add files to share
 */
export const addFiles = <TData = AddFilesResult>(
  shareId: string,
  addFilesBody: AddFilesBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/shares/files/add/${shareId}`, addFilesBody, options);
};

/**
 * @summary Remove files from share
 */
export const removeFiles = <TData = RemoveFilesResult>(
  shareId: string,
  removeFilesBody: RemoveFilesBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/shares/files/remove/${shareId}`, {
    data: removeFilesBody,
    ...options,
  });
};

/**
 * @summary Add recipients to a share
 */
export const addRecipients = <TData = AddRecipientsResult>(
  shareId: string,
  addRecipientsBody: AddRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/shares/recipients/add/${shareId}`, addRecipientsBody, options);
};

/**
 * Remove recipients from a share
 * @summary Remove recipients from a share
 */
export const removeRecipients = <TData = RemoveRecipientsResult>(
  shareId: string,
  removeRecipientsBody: RemoveRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/shares/recipients/remove/${shareId}`, {
    data: removeRecipientsBody,
    ...options,
  });
};

/**
 * @summary Create or update share alias
 */
export const createShareAlias = <TData = CreateShareAliasResult>(
  shareId: string,
  createShareAliasBody: CreateShareAliasBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/shares/alias/create/${shareId}`, createShareAliasBody, options);
};

/**
 * @summary Get share by alias
 */
export const getShareByAlias = <TData = GetShareByAliasResult>(
  alias: string,
  params?: GetShareByAliasParams,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  if (params?.password) {
    // Password-protected shares use the POST /access endpoint
    return apiInstance.post(
      `/api/shares/alias/${alias}/access`,
      { password: params.password },
      options,
    );
  }
  return apiInstance.get(`/api/shares/alias/get/${alias}`, options);
};

/**
 * Send email notification with share link to all recipients
 * @summary Send email notification to share recipients
 */
export const notifyRecipients = <TData = NotifyRecipientsResult>(
  shareId: string,
  notifyRecipientsBody: NotifyRecipientsBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(
    `/api/shares/recipients/notify/${shareId}`,
    notifyRecipientsBody,
    options,
  );
};

/**
 * @summary Add folders to share
 */
export const addFolders = <TData = unknown>(
  shareId: string,
  addFoldersBody: { folders: string[] },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/shares/folders/add/${shareId}`, addFoldersBody, options);
};

/**
 * @summary Remove folders from share
 */
export const removeFolders = <TData = unknown>(
  shareId: string,
  removeFoldersBody: { folders: string[] },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/shares/folders/remove/${shareId}`, {
    data: removeFoldersBody,
    ...options,
  });
};
