import type { UseFormReturn } from "react-hook-form";
import type {
  LdapConfig,
  LdapStatus,
  LdapSyncLog,
  LdapTestResult,
} from "@/http/endpoints/ldap/types";

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
  appUrl: string;
}

export interface LdapConfigFormProps {
  config: LdapConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  testResult: LdapTestResult | null;
  formMethods: UseFormReturn<LdapConfigFormData>;
  onSave: (data: LdapConfigFormData) => void;
  onTest: () => void;
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
