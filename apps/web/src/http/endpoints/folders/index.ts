import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  DeleteFolderResult,
  ListFoldersResult,
  MoveFolderBody,
  MoveFolderResult,
  RegisterFolderBody,
  RegisterFolderResult,
  UpdateFolderBody,
  UpdateFolderResult,
} from "./types";

export type { DeleteFolder409 } from "./types";

/**
 * Registers folder metadata in the database
 * @summary Register Folder Metadata
 */
export const registerFolder = (
  registerFolderBody: RegisterFolderBody,
  options?: AxiosRequestConfig,
): Promise<RegisterFolderResult> => {
  return apiInstance.post(`/api/folders`, registerFolderBody, options);
};

/**
 * Lists user folders with optional recursive structure
 * @summary List Folders
 */
export const listFolders = (options?: AxiosRequestConfig): Promise<ListFoldersResult> => {
  return apiInstance.get(`/api/folders`, options);
};

/**
 * Updates folder metadata
 * @summary Update Folder
 */
export const updateFolder = (
  id: string,
  updateFolderBody: UpdateFolderBody,
  options?: AxiosRequestConfig,
): Promise<UpdateFolderResult> => {
  return apiInstance.patch(`/api/folders/${id}`, updateFolderBody, options);
};

/**
 * Moves folder to different parent
 * @summary Move Folder
 */
export const moveFolder = (
  id: string,
  moveFolderBody: MoveFolderBody,
  options?: AxiosRequestConfig,
): Promise<MoveFolderResult> => {
  return apiInstance.put(`/api/folders/${id}/move`, moveFolderBody, options);
};

/**
 * Deletes a folder
 * @summary Delete Folder
 */
export const deleteFolder = (
  id: string,
  force?: boolean,
  options?: AxiosRequestConfig,
): Promise<DeleteFolderResult> => {
  const url = force ? `/api/folders/${id}?force=true` : `/api/folders/${id}`;
  return apiInstance.delete(url, options);
};
