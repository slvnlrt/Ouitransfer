import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type { BulkUpdateConfigsBody, BulkUpdateConfigsResult, GetAllConfigsResult } from "./types";

/**
 * List public configurations (excludes sensitive data)
 * @summary List public configurations
 */
export const getPublicConfigs = <TData = GetAllConfigsResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get(`/api/app/configs/public`, options);
};

/**
 * List all configurations (admin only)
 * @summary List all configurations
 */
export const getAllConfigs = <TData = GetAllConfigsResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get(`/api/app/configs`, options);
};

/**
 * Bulk update configuration values (admin only)
 * @summary Bulk update configuration values
 */
export const bulkUpdateConfigs = <TData = BulkUpdateConfigsResult>(
  bulkUpdateConfigsBody: BulkUpdateConfigsBody,
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.patch(`api/config/update/bulk`, bulkUpdateConfigsBody, options);
};
