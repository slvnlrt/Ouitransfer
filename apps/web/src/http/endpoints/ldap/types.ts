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
}

export interface LdapTestResult {
  success: boolean;
  memberCount: number;
  message: string;
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

export type GetLdapConfigResult = AxiosResponse<LdapConfig>;
export type UpdateLdapConfigResult = AxiosResponse<LdapConfig>;
export type TestLdapConnectionResult = AxiosResponse<LdapTestResult>;
export type TriggerLdapSyncResult = AxiosResponse<{ logId: string }>;
export type GetLdapSyncLogsResult = AxiosResponse<LdapSyncLogsResponse>;
export type GetLdapSyncLogDetailResult = AxiosResponse<LdapSyncLog>;
export type GetLdapStatusResult = AxiosResponse<LdapStatus>;
