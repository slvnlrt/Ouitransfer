import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  AuthProvider,
  CreateProviderResult,
  DeleteProviderResult,
  GetAllProvidersResult,
  GetAuthConfigResult,
  GetCurrentUserResult,
  GetEnabledProvidersResult,
  LoginBody,
  LoginResult,
  LogoutResult,
  NewProvider,
  RequestPasswordResetBody,
  RequestPasswordResetResult,
  ResetPasswordBody,
  ResetPasswordResult,
  UpdateProviderResult,
  UpdateProvidersOrderBody,
  UpdateProvidersOrderResult,
} from "./types";

export const login = (loginBody: LoginBody, options?: AxiosRequestConfig): Promise<LoginResult> => {
  return apiInstance.post(`/api/auth/login`, loginBody, options);
};

export const logout = (options?: AxiosRequestConfig): Promise<LogoutResult> => {
  return apiInstance.post(`/api/auth/logout`, undefined, options);
};

export const requestPasswordReset = (
  requestPasswordResetBody: RequestPasswordResetBody,
  options?: AxiosRequestConfig,
): Promise<RequestPasswordResetResult> => {
  return apiInstance.post(`/api/auth/forgot-password`, requestPasswordResetBody, options);
};

export const resetPassword = (
  resetPasswordBody: ResetPasswordBody,
  options?: AxiosRequestConfig,
): Promise<ResetPasswordResult> => {
  return apiInstance.post(`/api/auth/reset-password`, resetPasswordBody, options);
};

export const getCurrentUser = (options?: AxiosRequestConfig): Promise<GetCurrentUserResult> => {
  return apiInstance.get(`/api/auth/me`, options);
};

export const getEnabledProviders = (
  options?: AxiosRequestConfig,
): Promise<GetEnabledProvidersResult> => {
  return apiInstance.get(`/api/auth/providers`, options);
};

export const getAllProviders = (options?: AxiosRequestConfig): Promise<GetAllProvidersResult> => {
  return apiInstance.get(`/api/auth/providers/all`, options);
};

export const createProvider = (
  newProvider: NewProvider,
  options?: AxiosRequestConfig,
): Promise<CreateProviderResult> => {
  return apiInstance.post(`/api/auth/providers`, newProvider, options);
};

export const updateProvider = (
  id: string,
  updates: Partial<AuthProvider>,
  options?: AxiosRequestConfig,
): Promise<UpdateProviderResult> => {
  return apiInstance.put(`/api/auth/providers/manage/${id}`, updates, options);
};

export const deleteProvider = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteProviderResult> => {
  return apiInstance.delete(`/api/auth/providers/manage/${id}`, options);
};

export const updateProvidersOrder = (
  updateProvidersOrderBody: UpdateProvidersOrderBody,
  options?: AxiosRequestConfig,
): Promise<UpdateProvidersOrderResult> => {
  return apiInstance.put(`/api/auth/providers/order`, updateProvidersOrderBody, options);
};

export const getAuthConfig = (options?: AxiosRequestConfig): Promise<GetAuthConfigResult> => {
  return apiInstance.get(`/api/auth/config`, options);
};
