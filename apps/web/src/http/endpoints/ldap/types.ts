import type { AxiosResponse } from "axios";

export interface LdapConfig {
  configured: boolean;
  id?: string;
  enabled?: boolean;
  serverUrl?: string;
  bindDn?: string;
  bindPassword?: string;
  searchBase?: string;
  syncGroupDn?: string;
  usernameAttribute?: string;
  emailAttribute?: string;
  displayNameAttribute?: string;
  syncIntervalMinutes?: number;
  useTls?: boolean;
  tlsSkipVerify?: boolean;
  appUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LdapConfigBody {
  enabled: boolean;
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  syncGroupDn: string;
  usernameAttribute: string;
  emailAttribute: string;
  displayNameAttribute: string;
  syncIntervalMinutes: number;
  useTls: boolean;
  tlsSkipVerify?: boolean;
  appUrl?: string | null;
}

export interface LdapTestBody {
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  syncGroupDn: string;
  usernameAttribute: string;
  emailAttribute: string;
  displayNameAttribute: string;
  useTls: boolean;
  tlsSkipVerify?: boolean;
}

export interface LdapTestResult {
  success: boolean;
  memberCount: number;
  message: string;
}

/**
 * A directory node returned by the browse / group-search endpoints.
 *
 * Mirrors the server-side `LdapDirectoryNode`
 * (apps/server/src/modules/ldap/ldap.client.ts) exactly — the project
 * duplicates server/web types rather than sharing them (cf. `LdapTestBody`).
 */
export interface LdapDirectoryNode {
  dn: string;
  name: string;
  type: "ou" | "container" | "domain" | "group";
  hasChildren: boolean;
}

/** Connection fields shared by the browse and group-search request bodies. */
export interface LdapConnectionFields {
  serverUrl: string;
  bindDn: string;
  /** Empty / masked (`••••••••`) reuses the stored encrypted password server-side. */
  bindPassword: string;
  useTls: boolean;
  tlsSkipVerify?: boolean;
}

/**
 * Directory-browse body. Without `baseDn` the route reads the RootDSE (naming
 * contexts); with one it lists the immediate container children of that node.
 */
export interface LdapBrowseBody extends LdapConnectionFields {
  baseDn?: string;
}

export interface LdapBrowseResult {
  nodes: LdapDirectoryNode[];
  /**
   * The detected default base DN (AD `defaultNamingContext`), or `null` when
   * browsing children or on non-AD servers that don't expose it.
   */
  defaultBaseDn: string | null;
}

/** Group-search body: connection fields plus a DN search base and a query. */
export interface LdapSearchGroupsBody extends LdapConnectionFields {
  searchBase: string;
  query: string;
}

export interface LdapGroupSearchResult {
  groups: LdapDirectoryNode[];
  /** `true` when the server-side size cap was hit (results may be incomplete). */
  truncated: boolean;
}

export interface LdapSyncLog {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  trigger: string;
  usersCreated: number;
  usersUpdated: number;
  usersDeactivated: number;
  usersSkipped: number;
  usersReactivated: number;
  details: string | null;
}

export interface LdapSyncLogsResponse {
  logs: LdapSyncLog[];
  total: number;
}

export interface LdapStatus {
  configured: boolean;
  enabled: boolean;
  syncInProgress: boolean;
  warnings?: string[];
  lastSync: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    usersCreated: number;
    usersUpdated: number;
    usersDeactivated: number;
    usersReactivated: number;
    usersSkipped: number;
  } | null;
  nextSyncAt: string | null;
}

export type BrowseLdapDirectoryResult = AxiosResponse<LdapBrowseResult>;
export type SearchLdapGroupsResult = AxiosResponse<LdapGroupSearchResult>;
export type GetLdapConfigResult = AxiosResponse<LdapConfig>;
export type UpdateLdapConfigResult = AxiosResponse<LdapConfig>;
export type TestLdapConnectionResult = AxiosResponse<LdapTestResult>;
export type TriggerLdapSyncResult = AxiosResponse<{ logId: string }>;
export type GetLdapSyncLogsResult = AxiosResponse<LdapSyncLogsResponse>;
export type GetLdapSyncLogDetailResult = AxiosResponse<LdapSyncLog>;
export type GetLdapStatusResult = AxiosResponse<LdapStatus>;
