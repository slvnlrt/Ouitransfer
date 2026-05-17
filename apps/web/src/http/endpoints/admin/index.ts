import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type { AdminStatsResult } from "./types";

/**
 * Get platform-wide statistics (admin only)
 */
export const getAdminStats = <TData = AdminStatsResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get("/api/admin/stats", options);
};
