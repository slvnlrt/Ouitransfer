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
export const createReverseShare = (
  createReverseShareBody: CreateReverseShareBody,
  options?: AxiosRequestConfig,
): Promise<CreateReverseShareResult> => {
  return apiInstance.post(`/api/reverse-shares`, createReverseShareBody, options);
};

/**
 * List all reverse shares created by the authenticated user
 * @summary List User's Reverse Shares
 */
export const listUserReverseShares = (
  options?: AxiosRequestConfig,
): Promise<ListUserReverseSharesResult> => {
  return apiInstance.get(`/api/reverse-shares`, options);
};

/**
 * Update a reverse share
 * @summary Update Reverse Share
 */
export const updateReverseShare = (
  updateReverseShareBody: UpdateReverseShareBody,
  options?: AxiosRequestConfig,
): Promise<UpdateReverseShareResult> => {
  return apiInstance.put(`/api/reverse-shares`, updateReverseShareBody, options);
};

/**
 * Update reverse share password
 * @summary Update Reverse Share Password
 */
export const updateReverseSharePassword = (
  id: string,
  updateReverseSharePasswordBody: UpdateReverseSharePasswordBody,
  options?: AxiosRequestConfig,
): Promise<UpdateReverseSharePasswordResult> => {
  return apiInstance.put(
    `/api/reverse-shares/${id}/password`,
    updateReverseSharePasswordBody,
    options,
  );
};

/**
 * Delete a reverse share
 * @summary Delete Reverse Share
 */
export const deleteReverseShare = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteReverseShareResult> => {
  return apiInstance.delete(`/api/reverse-shares/${id}`, options);
};

/**
 * Get reverse share information for upload by alias (public endpoint)
 * @summary Get Reverse Share for Upload by Alias (Public)
 */
export const getReverseShareForUploadByAlias = (
  alias: string,
  params?: GetReverseShareForUploadParams,
  options?: AxiosRequestConfig,
): Promise<GetReverseShareForUploadResult> => {
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
export const getPresignedUrlForUploadByAlias = (
  alias: string,
  getPresignedUrlBody: GetPresignedUrlBody,
  params?: RegisterFileUploadParams,
  options?: AxiosRequestConfig,
): Promise<GetPresignedUrlResult> => {
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
export const registerFileUploadByAlias = (
  alias: string,
  registerFileUploadBody: RegisterFileUploadBody,
  params?: RegisterFileUploadParams,
  options?: AxiosRequestConfig,
): Promise<RegisterFileUploadResult> => {
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
export const downloadReverseShareFile = (
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<GetPresignedUrlResult> => {
  return apiInstance.get(`/api/reverse-shares/files/${fileId}/download`, options);
};

/**
 * Delete file from reverse share
 * @summary Delete File from Reverse Share
 */
export const deleteReverseShareFile = (
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<DeleteReverseShareFileByIdResult> => {
  return apiInstance.delete(`/api/reverse-shares/files/${fileId}`, options);
};

/**
 * Create or update reverse share alias
 * @summary Create or update reverse share alias
 */
export const createReverseShareAlias = (
  reverseShareId: string,
  createAliasBody: { alias: string },
  options?: AxiosRequestConfig,
): Promise<CreateReverseShareAliasResult> => {
  return apiInstance.post(`/api/reverse-shares/${reverseShareId}/alias`, createAliasBody, options);
};

/**
 * Update file from reverse share
 * @summary Update File from Reverse Share
 */
export const updateReverseShareFile = (
  fileId: string,
  updateReverseShareFileBody: UpdateReverseShareFileBody,
  options?: AxiosRequestConfig,
): Promise<UpdateReverseShareFileResult> => {
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
export const copyReverseShareFileToUserFiles = (
  fileId: string,
  options?: AxiosRequestConfig,
): Promise<CopyReverseShareFileResult> => {
  return apiInstance.post(`/api/reverse-shares/files/${fileId}/copy`, undefined, options);
};

/**
 * Create a multipart upload for reverse share (public endpoint)
 * @summary Create Multipart Upload for Reverse Share (Public)
 */
export const createMultipartUploadByAlias = (
  alias: string,
  body: { filename: string; extension: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<CreateMultipartUploadByAliasResult> => {
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
export const getMultipartPartUrlByAlias = (
  alias: string,
  params: { uploadId: string; objectName: string; partNumber: string; password?: string },
  options?: AxiosRequestConfig,
): Promise<GetMultipartPartUrlByAliasResult> => {
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
export const completeMultipartUploadByAlias = (
  alias: string,
  body: {
    uploadId: string;
    objectName: string;
    parts: Array<{ PartNumber: number; ETag: string }>;
  },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<CompleteMultipartUploadByAliasResult> => {
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
export const abortMultipartUploadByAlias = (
  alias: string,
  body: { uploadId: string; objectName: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<AbortMultipartUploadByAliasResult> => {
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
export const listMultipartPartsByAlias = (
  alias: string,
  body: { uploadId: string; objectName: string },
  params?: { password?: string },
  options?: AxiosRequestConfig,
): Promise<ListMultipartPartsByAliasResult> => {
  const requestBody = { ...body, ...(params?.password ? { password: params.password } : {}) };
  return apiInstance.post(
    `/api/reverse-shares/alias/${alias}/multipart/list-parts`,
    requestBody,
    options,
  );
};
