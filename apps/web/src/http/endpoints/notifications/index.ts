import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  GetEmailStatsResult,
  GetNotificationPreferencesResult,
  SendTestEmailResult,
  UpdateNotificationPreferencesBody,
  UpdateNotificationPreferencesResult,
} from "./types";

/**
 * Get notification preferences for the authenticated user
 */
export const getNotificationPreferences = (
  options?: AxiosRequestConfig,
): Promise<GetNotificationPreferencesResult> => {
  return apiInstance.get("/api/notifications/preferences", options);
};

/**
 * Update notification preferences
 */
export const updateNotificationPreferences = (
  body: UpdateNotificationPreferencesBody,
  options?: AxiosRequestConfig,
): Promise<UpdateNotificationPreferencesResult> => {
  return apiInstance.put("/api/notifications/preferences", body, options);
};

/**
 * Get email queue statistics (admin only)
 */
export const getEmailStats = (options?: AxiosRequestConfig): Promise<GetEmailStatsResult> => {
  return apiInstance.get("/api/admin/email/stats", options);
};

/**
 * Send a test email (admin only)
 */
export const sendTestEmail = (
  to: string,
  options?: AxiosRequestConfig,
): Promise<SendTestEmailResult> => {
  return apiInstance.post("/api/admin/email/test", { to }, options);
};
