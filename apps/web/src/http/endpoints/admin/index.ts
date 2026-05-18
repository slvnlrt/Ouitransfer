import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type { AdminStatsResult } from "./types";

/**
 * Get platform-wide statistics (admin only)
 */
export const getAdminStats = (options?: AxiosRequestConfig): Promise<AdminStatsResult> => {
  return apiInstance.get("/api/admin/stats", options);
};
