import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AbortMultipartUploadBody,
  AbortMultipartUploadResult,
  CheckFileBody,
  CheckFileResult,
  CompleteMultipartUploadBody,
  CompleteMultipartUploadResult,
  CreateMultipartUploadBody,
  CreateMultipartUploadResult,
  DeleteFileResult,
  GenerateEmbedTokenBody,
  GenerateEmbedTokenResult,
  GetDownloadUrlResult,
  GetMultipartPartUrlParams,
  GetMultipartPartUrlResult,
  GetPresignedUrlParams,
  GetPresignedUrlResult,
  ListFilesResult,
  ListMultipartPartsParams,
  ListMultipartPartsResult,
  MoveFileBody,
  MoveFileResult,
  RegisterFileBody,
  RegisterFileResult,
  UpdateFileBody,
  UpdateFileResult,
} from "./types";

/**
 * Generates a pre-signed URL for direct upload to S3-compatible storage
 * @summary Get Presigned URL for File
 */
export const getFilePresignedUrl = (
  params: GetPresignedUrlParams,
  options?: AxiosRequestConfig,
): Promise<GetPresignedUrlResult> => {
  return apiInstance.get(`/api/files/presigned-url`, {
    ...options,
    params: { ...params, ...options?.params },
  });
};

/**
 * Checks if the file meets constraints like MAX_FILESIZE
 * @summary Check file for constraints
 */
export const checkFile = (
  CheckFileBody: CheckFileBody,
  options?: AxiosRequestConfig,
): Promise<CheckFileResult> => {
  return apiInstance.post(`/api/files/check`, CheckFileBody, options);
};

/**
 * Registers file metadata in the database
 * @summary Register File Metadata
 */
export const registerFile = (
  registerFileBody: RegisterFileBody,
  options?: AxiosRequestConfig,
): Promise<RegisterFileResult> => {
  return apiInstance.post(`/api/files`, registerFileBody, options);
};

/**
 * Lists user files
 * @summary List Files
 */
export const listFiles = (
  params: { folderId?: string; recursive?: boolean } = {},
  options?: AxiosRequestConfig,
): Promise<ListFilesResult> => {
  const queryParams = {
    ...params,
    recursive: params.recursive !== undefined ? params.recursive.toString() : undefined,
  };

  return apiInstance.get(`/api/files`, {
    ...options,
    params: { ...queryParams, ...options?.params },
  });
};

/**
 * Generates a pre-signed URL for downloading a private file
 * @summary Get Download URL
 */
export const getDownloadUrl = (
  objectName: string,
  password?: string,
  options?: AxiosRequestConfig,
): Promise<GetDownloadUrlResult> => {
  const body: { objectName: string; password?: string } = { objectName };
  if (password) {
    body.password = password;
  }
  return apiInstance.post(`/api/files/download-url`, body, options);
};

/**
 * Deletes a user file
 * @summary Delete File
 */
export const deleteFile = (id: string, options?: AxiosRequestConfig): Promise<DeleteFileResult> => {
  return apiInstance.delete(`/api/files/${id}`, options);
};

/**
 * Updates file metadata in the database
 * @summary Update File Metadata
 */
export const updateFile = (
  id: string,
  updateFileBody: UpdateFileBody,
  options?: AxiosRequestConfig,
): Promise<UpdateFileResult> => {
  return apiInstance.patch(`/api/files/${id}`, updateFileBody, options);
};

/**
 * Moves a file to a different folder
 * @summary Move File
 */
export const moveFile = (
  id: string,
  moveFileBody: MoveFileBody,
  options?: AxiosRequestConfig,
): Promise<MoveFileResult> => {
  return apiInstance.put(`/api/files/${id}/move`, moveFileBody, options);
};

/**
 * Creates a multipart upload session
 * @summary Create Multipart Upload
 */
export const createMultipartUpload = (
  createMultipartUploadBody: CreateMultipartUploadBody,
  options?: AxiosRequestConfig,
): Promise<CreateMultipartUploadResult> => {
  return apiInstance.post(`/api/files/multipart/create`, createMultipartUploadBody, options);
};

/**
 * Gets a presigned URL for uploading a specific part
 * @summary Get Multipart Part URL
 */
export const getMultipartPartUrl = (
  params: GetMultipartPartUrlParams,
  options?: AxiosRequestConfig,
): Promise<GetMultipartPartUrlResult> => {
  return apiInstance.get(`/api/files/multipart/part-url`, {
    ...options,
    params: { ...params, ...options?.params },
  });
};

/**
 * Completes a multipart upload
 * @summary Complete Multipart Upload
 */
export const completeMultipartUpload = (
  completeMultipartUploadBody: CompleteMultipartUploadBody,
  options?: AxiosRequestConfig,
): Promise<CompleteMultipartUploadResult> => {
  return apiInstance.post(`/api/files/multipart/complete`, completeMultipartUploadBody, options);
};

/**
 * Aborts a multipart upload
 * @summary Abort Multipart Upload
 */
export const abortMultipartUpload = (
  abortMultipartUploadBody: AbortMultipartUploadBody,
  options?: AxiosRequestConfig,
): Promise<AbortMultipartUploadResult> => {
  return apiInstance.post(`/api/files/multipart/abort`, abortMultipartUploadBody, options);
};

/**
 * Lists already-uploaded parts for a multipart upload (enables upload resume)
 * @summary List Multipart Parts
 */
export const listMultipartParts = (
  params: ListMultipartPartsParams,
  options?: AxiosRequestConfig,
): Promise<ListMultipartPartsResult> => {
  return apiInstance.get(`/api/files/multipart/list-parts`, {
    ...options,
    params: { ...params, ...options?.params },
  });
};

/**
 * Generates a signed embed token for a file in a share
 * @summary Generate Embed Token
 */
export const generateEmbedToken = (
  generateEmbedTokenBody: GenerateEmbedTokenBody,
  options?: AxiosRequestConfig,
): Promise<GenerateEmbedTokenResult> => {
  return apiInstance.post(`/api/files/embed-token`, generateEmbedTokenBody, options);
};
