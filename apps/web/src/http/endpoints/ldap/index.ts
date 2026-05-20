import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  GetLdapConfigResult,
  GetLdapStatusResult,
  GetLdapSyncLogDetailResult,
  GetLdapSyncLogsResult,
  LdapConfigBody,
  LdapTestBody,
  TestLdapConnectionResult,
  TriggerLdapSyncResult,
  UpdateLdapConfigResult,
} from "./types";

/** Get LDAP configuration (bind password masked) */
export const getLdapConfig = (options?: AxiosRequestConfig): Promise<GetLdapConfigResult> => {
  return apiInstance.get("/api/admin/ldap/config", options);
};

/** Create or update LDAP configuration */
export const updateLdapConfig = (
  body: LdapConfigBody,
  options?: AxiosRequestConfig,
): Promise<UpdateLdapConfigResult> => {
  return apiInstance.put("/api/admin/ldap/config", body, options);
};

/** Test LDAP connection with given credentials */
export const testLdapConnection = (
  body: LdapTestBody,
  options?: AxiosRequestConfig,
): Promise<TestLdapConnectionResult> => {
  return apiInstance.post("/api/admin/ldap/test", body, options);
};

/** Trigger manual LDAP sync */
export const triggerLdapSync = (options?: AxiosRequestConfig): Promise<TriggerLdapSyncResult> => {
  return apiInstance.post("/api/admin/ldap/sync", {}, options);
};

/** List sync history (paginated) */
export const getLdapSyncLogs = (
  params: { limit?: number; offset?: number },
  options?: AxiosRequestConfig,
): Promise<GetLdapSyncLogsResult> => {
  return apiInstance.get("/api/admin/ldap/sync/logs", {
    params,
    ...options,
  });
};

/** Get sync log detail with skip/error messages */
export const getLdapSyncLogDetail = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<GetLdapSyncLogDetailResult> => {
  return apiInstance.get(`/api/admin/ldap/sync/logs/${id}`, options);
};

/** Get LDAP status overview */
export const getLdapStatus = (options?: AxiosRequestConfig): Promise<GetLdapStatusResult> => {
  return apiInstance.get("/api/admin/ldap/status", options);
};
