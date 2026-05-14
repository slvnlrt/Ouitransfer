import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AbortMultipartUploadByAliasResult,
  CompleteMultipartUploadByAliasResult,
  CopyReverseShareFileResult,
  CreateMultipartUploadByAliasResult,
  CreateReverseShareAliasResult,
  CreateReverseShareBody,
  CreateReverseShareResult,
  DeleteReverseShareFileByIdResult,
  DeleteReverseShareResult,
  GetMultipartPartUrlByAliasResult,
  GetPresignedUrlBody,
  GetPresignedUrlResult,
  GetReverseShareForUploadParams,
  GetReverseShareForUploadResult,
  ListMultipartPartsByAliasResult,
  ListUserReverseSharesResult,
  RegisterFileUploadBody,
  RegisterFileUploadParams,
  RegisterFileUploadResult,
  UpdateReverseShareBody,
  UpdateReverseShareFileBody,
  UpdateReverseShareFileResult,
  UpdateReverseSharePasswordBody,
  UpdateReverseSharePasswordResult,
  UpdateReverseShareResult,
} from "./types";

/**
 * Create a new reverse share
 * @summary Create Reverse Share
 */
export const createReverseShare = <TData = CreateReverseShareResult>(
  createReverseShareBody: CreateReverseShareBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/reverse-shares/create`, createReverseShareBody, options);
};

/**
 * List all reverse shares created by the authenticated user
 * @summary List User's Reverse Shares
 */
export const listUserReverseShares = <TData = ListUserReverseSharesResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get(`/api/reverse-shares/list`, options);
};

/**
 * Update a reverse share
 * @summary Update Reverse Share
 */
export const updateReverseShare = <TData = UpdateReverseShareResult>(
  updateReverseShareBody: UpdateReverseShareBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.put(`/api/reverse-shares/update`, updateReverseShareBody, options);
};

/**
 * Update reverse share password
 * @summary Update Reverse Share Password
 */
export const updateReverseSharePassword = <TData = UpdateReverseSharePasswordResult>(
  id: string,
  updateReverseSharePasswordBody: UpdateReverseSharePasswordBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.put(
    `/api/reverse-shares/password/${id}`,
    updateReverseSharePasswordBody,
    options,
  );
};

/**
 * Delete a reverse share
 * @summary Delete Reverse Share
 */
export const deleteReverseShare = <TData = DeleteReverseShareResult>(
  id: string,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/reverse-shares/delete/${id}`, options);
};

/**
 * Get reverse share information for upload by alias (public endpoint)
 * @summary Get Reverse Share for Upload by Alias (Public)
 */
export const getReverseShareForUploadByAlias = <TData = GetReverseShareForUploadResult>(
  alias: string,
  params?: GetReverseShareForUploadParams,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  if (params?.password) {
    // Password-protected reverse shares use the POST /access endpoint
    return apiInstance.post(
      `/api/reverse-shares/alias/${alias}/upload/access`,
      { password: params.password },
      options,
    );
  }
  return apiInstance.get(`/api/reverse-shares/alias/${alias}/upload`, options);
};

/**
 * Get presigned URL for upload to reverse share by alias (public endpoint)
 * @summary Get Presigned URL for File Upload by Alias (Public)
 */
export const getPresignedUrlForUploadByAlias = <TData = GetPresignedUrlResult>(
  alias: string,
  getPresignedUrlBody: GetPresignedUrlBody,
  params?: RegisterFileUploadParams,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const body = {
    ...getPresignedUrlBody,
    ...(params?.password ? { password: params.password } : {}),
  };
  return apiInstance.post(`/api/reverse-shares/alias/${alias}/presigned-url`, body, options);
};

/**
 * Register file upload completion by alias (public endpoint)
 * @summary Register File Upload Completion by Alias (Public)
 */
export const registerFileUploadByAlias = <TData = RegisterFileUploadResult>(
  alias: string,
  registerFileUploadBody: RegisterFileUploadBody,
  params?: RegisterFileUploadParams,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const body = {
    ...registerFileUploadBody,
    ...(params?.password ? { password: params.password } : {}),
  };
  return apiInstance.post(`/api/reverse-shares/alias/${alias}/register-file`, body, options);
};

/**
 * Download file from reverse share
 * @summary Download File from Reverse Share
 */
export const downloadReverseShareFile = <TData = GetPresignedUrlResult>(
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get(`/api/reverse-shares/files/download/${fileId}`, options);
};

/**
 * Delete file from reverse share
 * @summary Delete File from Reverse Share
 */
export const deleteReverseShareFile = <TData = DeleteReverseShareFileByIdResult>(
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.delete(`/api/reverse-shares/files/${fileId}`, options);
};

/**
 * Create or update reverse share alias
 * @summary Create or update reverse share alias
 */
export const createReverseShareAlias = <TData = CreateReverseShareAliasResult>(
  reverseShareId: string,
  createAliasBody: { alias: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/reverse-shares/${reverseShareId}/alias`, createAliasBody, options);
};

/**
 * Update file from reverse share
 * @summary Update File from Reverse Share
 */
export const updateReverseShareFile = <TData = UpdateReverseShareFileResult>(
  fileId: string,
  updateReverseShareFileBody: UpdateReverseShareFileBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.put(
    `/api/reverse-shares/files/${fileId}`,
    updateReverseShareFileBody,
    options,
  );
};

/**
 * Copy file from reverse share to user files
 * @summary Copy File from Reverse Share to User Files
 */
export const copyReverseShareFileToUserFiles = <TData = CopyReverseShareFileResult>(
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.post(`/api/reverse-shares/files/${fileId}/copy`, undefined, options);
};

/**
 * Create a multipart upload for reverse share (public endpoint)
 * @summary Create Multipart Upload for Reverse Share (Public)
 */
export const createMultipartUploadByAlias = <TData = CreateMultipartUploadByAliasResult>(
  alias: string,
  body: { filename: string; extension: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const requestBody = { ...body, ...(params?.password ? { password: params.password } : {}) };
  return apiInstance.post(
    `/api/reverse-shares/alias/${alias}/multipart/create`,
    requestBody,
    options,
  );
};

/**
 * Get presigned URL for a multipart upload part for reverse share (public endpoint)
 * Changed from GET to POST to send password in body instead of query params
 * @summary Get Multipart Part URL for Reverse Share (Public)
 */
export const getMultipartPartUrlByAlias = <TData = GetMultipartPartUrlByAliasResult>(
  alias: string,
  params: { uploadId: string; objectName: string; partNumber: string; password?: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const { uploadId, objectName, partNumber, password } = params;
  const body: { uploadId: string; objectName: string; partNumber: string; password?: string } = {
    uploadId,
    objectName,
    partNumber,
  };
  if (password) {
    body.password = password;
  }
  return apiInstance.post(`/api/reverse-shares/alias/${alias}/multipart/part-url`, body, options);
};

/**
 * Complete a multipart upload for reverse share (public endpoint)
 * @summary Complete Multipart Upload for Reverse Share (Public)
 */
export const completeMultipartUploadByAlias = <TData = CompleteMultipartUploadByAliasResult>(
  alias: string,
  body: {
    uploadId: string;
    objectName: string;
    parts: Array<{ PartNumber: number; ETag: string }>;
  },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const requestBody = { ...body, ...(params?.password ? { password: params.password } : {}) };
  return apiInstance.post(
    `/api/reverse-shares/alias/${alias}/multipart/complete`,
    requestBody,
    options,
  );
};

/**
 * Abort a multipart upload for reverse share (public endpoint)
 * @summary Abort Multipart Upload for Reverse Share (Public)
 */
export const abortMultipartUploadByAlias = <TData = AbortMultipartUploadByAliasResult>(
  alias: string,
  body: { uploadId: string; objectName: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const requestBody = { ...body, ...(params?.password ? { password: params.password } : {}) };
  return apiInstance.post(
    `/api/reverse-shares/alias/${alias}/multipart/abort`,
    requestBody,
    options,
  );
};

/**
 * List already-uploaded parts for a multipart upload to a reverse share (public endpoint)
 * @summary List Multipart Parts for Reverse Share (Public)
 */
export const listMultipartPartsByAlias = <TData = ListMultipartPartsByAliasResult>(
  alias: string,
  body: { uploadId: string; objectName: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<TData> => {
  const requestBody = { ...body, ...(params?.password ? { password: params.password } : {}) };
  return apiInstance.post(
    `/api/reverse-shares/alias/${alias}/multipart/list-parts`,
    requestBody,
    options,
  );
};
