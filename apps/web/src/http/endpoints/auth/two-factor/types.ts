import type { AxiosResponse } from "axios";

export interface TwoFactorSetupRequest {
  appName?: string;
}

export interface BackupCode {
  code: string;
  used: boolean;
}

export interface TwoFactorSetupResponse {
  secret: string;
  qrCode: string;
  manualEntryKey: string;
  backupCodes: BackupCode[];
}

export interface VerifySetupRequest {
  token: string;
  secret: string;
  password: string; // re-authentication required to enable 2FA
}

export interface VerifySetupResponse {
  success: boolean;
  backupCodes: string[];
}

export interface DisableTwoFactorRequest {
  password: string;
  totpCode: string; // TOTP code or backup code — now required
}

export interface DisableTwoFactorResponse {
  success: boolean;
}

export interface GenerateBackupCodesRequest {
  password: string;
  totpCode: string; // TOTP code or backup code — step-up re-authentication
}

export interface GenerateBackupCodesResponse {
  backupCodes: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  verified: boolean;
  availableBackupCodes: number;
}

export interface CompleteTwoFactorLoginRequest {
  challengeToken: string;
  token: string;
  rememberDevice?: boolean;
}

export interface LoginResponse {
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    image?: string | null;
    isAdmin: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  message?: string;
}

export type TwoFactorSetupResult = AxiosResponse<TwoFactorSetupResponse>;
export type VerifySetupResult = AxiosResponse<VerifySetupResponse>;
export type DisableTwoFactorResult = AxiosResponse<DisableTwoFactorResponse>;
export type GenerateBackupCodesResult = AxiosResponse<GenerateBackupCodesResponse>;
export type GetTwoFactorStatusResult = AxiosResponse<TwoFactorStatus>;
export type CompleteTwoFactorLoginResult = AxiosResponse<LoginResponse>;
