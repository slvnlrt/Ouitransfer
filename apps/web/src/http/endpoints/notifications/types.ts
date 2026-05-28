import type { AxiosResponse } from "axios";

export interface NotificationPreference {
  type: string;
  frequency: string;
  configurable: boolean;
  isCritical: boolean;
  defaultFrequency: string;
}

export interface GetNotificationPreferences200 {
  preferences: NotificationPreference[];
}

export interface UpdatePreferenceItem {
  type: string;
  frequency: string;
}

export interface UpdateNotificationPreferencesBody {
  preferences: UpdatePreferenceItem[];
}

export interface UpdateNotificationPreferences200 {
  message: string;
}

export interface EmailStats {
  pending: number;
  sentLast24h: number;
  failed: number;
}

export interface SendTestEmail200 {
  success: boolean;
  message: string;
}

export type GetNotificationPreferencesResult = AxiosResponse<GetNotificationPreferences200>;
export type UpdateNotificationPreferencesResult = AxiosResponse<UpdateNotificationPreferences200>;
export type GetEmailStatsResult = AxiosResponse<EmailStats>;
export type SendTestEmailResult = AxiosResponse<SendTestEmail200>;
