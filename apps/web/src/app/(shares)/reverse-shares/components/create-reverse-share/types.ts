export interface CreateReverseShareFormData {
  name: string;
  description?: string;
  expiration?: string;
  maxFiles?: string;
  maxFileSize?: string;
  allowedFileTypes?: string;
  password?: string;
  pageLayout?: "DEFAULT" | "WETRANSFER";
  backgroundImageId?: string | null;
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  isPasswordProtected: boolean;
  hasExpiration: boolean;
  hasFileLimits: boolean;
  hasFieldRequirements: boolean;
  noFilesLimit: boolean;
  noSizeLimit: boolean;
  allFileTypes: boolean;
  notifyOnUpload: boolean;
  bypassUploadCooldown: boolean;
}

export const DEFAULT_FORM_VALUES: CreateReverseShareFormData = {
  name: "",
  description: "",
  expiration: "",
  maxFiles: "",
  maxFileSize: "",
  allowedFileTypes: "",
  password: "",
  pageLayout: "DEFAULT",
  backgroundImageId: null,
  nameFieldRequired: "OPTIONAL",
  emailFieldRequired: "OPTIONAL",
  isPasswordProtected: false,
  hasExpiration: false,
  hasFileLimits: false,
  hasFieldRequirements: false,
  noFilesLimit: true,
  noSizeLimit: true,
  allFileTypes: true,
  notifyOnUpload: false,
  bypassUploadCooldown: false,
};
