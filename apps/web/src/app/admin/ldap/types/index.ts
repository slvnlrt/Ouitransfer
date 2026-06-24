import type { UseFormReturn } from "react-hook-form";
import type { LdapStatus, LdapSyncLog, LdapTestResult } from "@/http/endpoints/ldap/types";

/**
 * The live connection values a browse/search dialog binds with. Watched from the
 * config form so directory reads reflect unsaved edits. `bindPassword` may be
 * empty when the config is already saved — the server reuses the stored value.
 */
export interface LdapConnectionValues {
  serverUrl: string;
  bindDn: string;
  bindPassword: string;
  useTls: boolean;
  tlsSkipVerify: boolean;
}

export interface LdapDirectoryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: LdapConnectionValues;
  /** Sets the Base DN field (`searchBase`) and closes the dialog. */
  onSelect: (dn: string) => void;
}

export interface LdapGroupSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: LdapConnectionValues;
  /** The search base the group lookup is rooted at (`scope: "sub"`). */
  searchBase: string;
  /** Sets the Sync Group field (`syncGroupDn`) and closes the dialog. */
  onSelect: (dn: string) => void;
}

export interface LdapConfigFormData {
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
  tlsSkipVerify: boolean;
  appUrl: string;
}

export interface LdapConfigFormProps {
  isSaving: boolean;
  isTesting: boolean;
  testResult: LdapTestResult | null;
  formMethods: UseFormReturn<LdapConfigFormData>;
  onSave: (data: LdapConfigFormData) => void;
  onTest: () => void;
  /**
   * Whether an LDAP config is already saved. When true, the server can reuse the
   * stored bind password, so the Browse buttons are usable even with an empty
   * password field.
   */
  configSaved: boolean;
}

export interface GroupMappingItem {
  id: string;
  name: string;
  ldapDn: string;
}

export interface LdapGroupMappingProps {
  groups: GroupMappingItem[];
  isLoading: boolean;
}

export interface LdapSyncOperationsProps {
  status: LdapStatus | null;
  logs: LdapSyncLog[];
  totalLogs: number;
  isLoading: boolean;
  isSyncing: boolean;
  onSync: () => void;
  onViewDetail: (log: LdapSyncLog) => void;
  page: number;
  onPageChange: (page: number) => void;
}

export interface LdapSyncDetailModalProps {
  log: LdapSyncLog | null;
  isOpen: boolean;
  onClose: () => void;
}
