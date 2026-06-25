import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  BrowseLdapDirectoryResult,
  GetLdapConfigResult,
  GetLdapStatusResult,
  GetLdapSyncLogDetailResult,
  GetLdapSyncLogsResult,
  LdapBrowseBody,
  LdapConfigBody,
  LdapSearchGroupsBody,
  LdapTestBody,
  SearchLdapGroupsResult,
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

/**
 * Browse the LDAP directory tree.
 *
 * Without `baseDn` the response holds the naming-context roots and the detected
 * `defaultBaseDn`; with `baseDn` it holds that node's container children.
 */
export const browseLdapDirectory = (
  body: LdapBrowseBody,
  options?: AxiosRequestConfig,
): Promise<BrowseLdapDirectoryResult> => {
  return apiInstance.post("/api/admin/ldap/browse", body, options);
};

/** Search the LDAP directory for groups under a search base. */
export const searchLdapGroups = (
  body: LdapSearchGroupsBody,
  options?: AxiosRequestConfig,
): Promise<SearchLdapGroupsResult> => {
  return apiInstance.post("/api/admin/ldap/search-groups", body, options);
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
