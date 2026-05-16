export interface EditReverseShareFormData {
  name: string;
  description?: string;
  expiration?: string;
  maxFiles?: string;
  maxFileSize?: string;
  allowedFileTypes?: string;
  pageLayout?: "DEFAULT" | "WETRANSFER";
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  hasExpiration: boolean;
  hasFileLimits: boolean;
  hasFieldRequirements: boolean;
  hasPassword: boolean;
  password?: string;
  isActive: boolean;
  noFilesLimit: boolean;
  noSizeLimit: boolean;
  allFileTypes: boolean;
}

export const DEFAULT_VALUES = {
  EMPTY_STRING: "",
  ZERO_STRING: "0",
  PAGE_LAYOUT: "DEFAULT" as const,
} as const;

interface WatchedValues {
  hasExpiration: boolean;
  hasFileLimits: boolean;
  hasFieldRequirements: boolean;
  noFilesLimit: boolean;
  noSizeLimit: boolean;
  allFileTypes: boolean;
  hasPassword: boolean;
}
