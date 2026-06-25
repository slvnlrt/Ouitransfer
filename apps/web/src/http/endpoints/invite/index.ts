import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  GenerateInviteTokenRequest,
  GenerateInviteTokenResponse,
  RegisterWithInviteRequest,
  RegisterWithInviteResponse,
  ValidateInviteTokenResponse,
} from "./types";

/**
 * Invite token endpoints.
 * All functions return unwrapped response data (not AxiosResponse).
 */

export const generateInviteToken = async (
  data?: GenerateInviteTokenRequest,
  options?: AxiosRequestConfig,
): Promise<GenerateInviteTokenResponse> => {
  const response = await apiInstance.post(`/api/invite-tokens`, data, options);
  return response.data;
};

export const validateInviteToken = async (
  token: string,
  options?: AxiosRequestConfig,
): Promise<ValidateInviteTokenResponse> => {
  const response = await apiInstance.get(`/api/invite-tokens/${token}`, options);
  return response.data;
};

export const registerWithInvite = async (
  data: RegisterWithInviteRequest,
  options?: AxiosRequestConfig,
): Promise<RegisterWithInviteResponse> => {
  const response = await apiInstance.post(`/api/register-with-invite`, data, options);
  return response.data;
};
