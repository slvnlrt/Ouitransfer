import type { NotificationType } from "@ouitransfer/shared/notification-types";
import type { AxiosResponse } from "axios";

import type { EmailHealthStatus } from "@/http/endpoints/app/types";

export interface NotificationPreference {
  type: NotificationType;
  frequency: string;
  configurable: boolean;
  isCritical: boolean;
  defaultFrequency: string;
}

export interface GetNotificationPreferences200 {
  preferences: NotificationPreference[];
}

export interface UpdatePreferenceItem {
  type: NotificationType;
  frequency: "immediate" | "disabled";
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
  digestPending: number;
  status: EmailHealthStatus;
  smtpConfigured: boolean;
  lastError: string | null;
}

export interface SendTestEmail200 {
  success: boolean;
  message: string;
}

export type GetNotificationPreferencesResult = AxiosResponse<GetNotificationPreferences200>;
export type UpdateNotificationPreferencesResult = AxiosResponse<UpdateNotificationPreferences200>;
export type GetEmailStatsResult = AxiosResponse<EmailStats>;
export type SendTestEmailResult = AxiosResponse<SendTestEmail200>;
