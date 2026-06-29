import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  ActivateUserResult,
  DeactivateUserResult,
  DeleteUserResult,
  GetUserQuotaResult,
  ListUsersResult,
  RegisterUserBody,
  RegisterUserResult,
  RemoveAvatarResult,
  UpdateMyLocaleResult,
  UpdateQuotaBody,
  UpdateUserBody,
  UpdateUserQuotaResult,
  UpdateUserResult,
  UploadAvatarBody,
  UploadAvatarResult,
} from "./types";

/**
 * Register a new user (admin only)
 * @summary Register New User
 */
export const registerUser = (
  registerUserBody: RegisterUserBody,
  options?: AxiosRequestConfig,
): Promise<RegisterUserResult> => {
  return apiInstance.post(`/api/auth/register`, registerUserBody, options);
};

/**
 * List all users (admin only)
 * @summary List All Users
 */
export const listUsers = (options?: AxiosRequestConfig): Promise<ListUsersResult> => {
  return apiInstance.get(`/api/users`, options);
};

/**
 * Update user data (admin only)
 * @summary Update User Data
 */
export const updateUser = (
  updateUserBody: UpdateUserBody,
  options?: AxiosRequestConfig,
): Promise<UpdateUserResult> => {
  return apiInstance.put(`/api/users`, updateUserBody, options);
};

/**
 * Delete a user (admin only)
 * @summary Delete User
 */
export const deleteUser = (id: string, options?: AxiosRequestConfig): Promise<DeleteUserResult> => {
  return apiInstance.delete(`/api/users/${id}`, options);
};

/**
 * Activate a user (admin only)
 * @summary Activate User
 */
export const activateUser = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<ActivateUserResult> => {
  return apiInstance.patch(`/api/users/${id}/activate`, undefined, options);
};

/**
 * Deactivate a user (admin only)
 * @summary Deactivate User
 */
export const deactivateUser = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeactivateUserResult> => {
  return apiInstance.patch(`/api/users/${id}/deactivate`, undefined, options);
};

/**
 * Upload and update user profile image
 * @summary Upload user avatar
 */
export const uploadAvatar = (
  uploadAvatarBody: UploadAvatarBody,
  options?: AxiosRequestConfig,
): Promise<UploadAvatarResult> => {
  const formData = new FormData();

  if (uploadAvatarBody.file !== undefined) {
    formData.append("file", uploadAvatarBody.file as Blob);
  }

  return apiInstance.post(`/api/users/avatar`, formData, {
    ...options,
    headers: {
      ...options?.headers,
      "Content-Type": "multipart/form-data",
    },
  });
};

/**
 * Remove user profile image
 * @summary Remove user avatar
 */
export const removeAvatar = (options?: AxiosRequestConfig): Promise<RemoveAvatarResult> => {
  return apiInstance.delete(`/api/users/avatar`, options);
};

/**
 * Persist the authenticated user's preferred language. Used as the email language
 * for messages sent to them and as the best-available language for invitations
 * they send to external recipients.
 * @summary Update Locale Preference
 */
export const updateMyLocale = (
  locale: string,
  options?: AxiosRequestConfig,
): Promise<UpdateMyLocaleResult> => {
  return apiInstance.patch(`/api/users/me/locale`, { locale }, options);
};

/**
 * Get quota status for a user (admin only)
 * @summary Get User Quota
 */
export const getUserQuota = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<GetUserQuotaResult> => {
  return apiInstance.get(`/api/users/${id}/quota`, options);
};

/**
 * Update quota overrides for a user (admin only)
 * @summary Update User Quota
 */
export const updateUserQuota = (
  id: string,
  body: UpdateQuotaBody,
  options?: AxiosRequestConfig,
): Promise<UpdateUserQuotaResult> => {
  return apiInstance.patch(`/api/users/${id}/quota`, body, options);
};
