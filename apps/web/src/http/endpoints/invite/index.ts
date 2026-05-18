import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  GenerateInviteTokenResponse,
  RegisterWithInviteRequest,
  RegisterWithInviteResult,
  ValidateInviteTokenResponse,
} from "./types";

export const generateInviteToken = async (
  options?: AxiosRequestConfig,
): Promise<GenerateInviteTokenResponse> => {
  const response = await apiInstance.post(`/api/invite-tokens`, undefined, options);
  return response.data;
};

export const validateInviteToken = async (
  token: string,
  options?: AxiosRequestConfig,
): Promise<ValidateInviteTokenResponse> => {
  const response = await apiInstance.get(`/api/invite-tokens/${token}`, options);
  return response.data;
};

export const registerWithInvite = (
  data: RegisterWithInviteRequest,
  options?: AxiosRequestConfig,
): Promise<RegisterWithInviteResult> => {
  return apiInstance.post(`/api/register-with-invite`, data, options);
};
