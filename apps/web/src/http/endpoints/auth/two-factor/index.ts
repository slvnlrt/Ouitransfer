import apiInstance from "@/config/api";
import type {
  CompleteTwoFactorLoginRequest,
  CompleteTwoFactorLoginResult,
  DisableTwoFactorRequest,
  DisableTwoFactorResult,
  GenerateBackupCodesRequest,
  GenerateBackupCodesResult,
  GetTwoFactorStatusResult,
  TwoFactorSetupRequest,
  TwoFactorSetupResult,
  VerifySetupRequest,
  VerifySetupResult,
} from "./types";

export const generate2FASetup = async (
  data?: TwoFactorSetupRequest,
): Promise<TwoFactorSetupResult> => {
  return apiInstance.post("/api/auth/2fa/setup", data);
};

export const verifyTwoFactorSetup = async (
  data: VerifySetupRequest,
): Promise<VerifySetupResult> => {
  return apiInstance.post("/api/auth/2fa/verify-setup", data);
};

export const disableTwoFactor = async (
  data: DisableTwoFactorRequest,
): Promise<DisableTwoFactorResult> => {
  return apiInstance.post("/api/auth/2fa/disable", data);
};

export const generateBackupCodes = async (
  data: GenerateBackupCodesRequest,
): Promise<GenerateBackupCodesResult> => {
  return apiInstance.post("/api/auth/2fa/backup-codes", data);
};

export const getTwoFactorStatus = async (): Promise<GetTwoFactorStatusResult> => {
  return apiInstance.get("/api/auth/2fa/status");
};

export const completeTwoFactorLogin = async (
  data: CompleteTwoFactorLoginRequest,
): Promise<CompleteTwoFactorLoginResult> => {
  return apiInstance.post("/api/auth/2fa/login", data);
};
