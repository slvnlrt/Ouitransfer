import type { AxiosResponse } from "axios";

export type FieldRequirement = "HIDDEN" | "OPTIONAL" | "REQUIRED";
export type PageLayout = "WETRANSFER" | "DEFAULT";

export interface ReverseShareFile {
  id: string;
  name: string;
  description: string | null;
  extension: string;
  size: string;
  objectName: string;
  uploaderEmail: string | null;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReverseShareAlias {
  id: string;
  alias: string;
  reverseShareId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BaseReverseShare {
  id: string;
  name: string | null;
  description: string | null;
  expiration: string | null;
  maxFiles: number | null;
  maxFileSize: number | null;
  allowedFileTypes: string | null;
  pageLayout: string;
  isActive: boolean;
  hasPassword: boolean;
  nameFieldRequired: string;
  emailFieldRequired: string;
  backgroundImageId: string | null;
  createdAt: string;
  updatedAt: string;
  creatorId: string;
  files: ReverseShareFile[];
}

export interface ReverseShareWithAlias extends BaseReverseShare {
  alias?: ReverseShareAlias | null;
}

export interface ReverseShareForUpload {
  id: string;
  name: string | null;
  description: string | null;
  maxFiles: number | null;
  maxFileSize: number | null;
  allowedFileTypes: string | null;
  pageLayout: string;
  hasPassword: boolean;
  currentFileCount: number;
  nameFieldRequired: string;
  emailFieldRequired: string;
  backgroundImageId: string | null;
}

export interface CreateReverseShare201 {
  reverseShare: BaseReverseShare;
}

export interface UpdateReverseShare200 {
  reverseShare: BaseReverseShare;
}

export interface ListUserReverseShares200 {
  reverseShares: ReverseShareWithAlias[];
}

export interface DeleteReverseShare200 {
  reverseShare: BaseReverseShare;
}

export interface GetReverseShareForUpload200 {
  reverseShare: ReverseShareForUpload;
}

export interface UpdateReverseSharePassword200 {
  reverseShare: BaseReverseShare;
}

export interface GetPresignedUrl200 {
  url: string;
  objectName: string;
  expiresIn: number;
}

export interface RegisterFileUpload201 {
  file: ReverseShareFile;
}

export interface UpdateReverseShareFile200 {
  file: ReverseShareFile;
}

export interface CreateReverseShareBody {
  name?: string;
  description?: string;
  expiration?: string;
  maxFiles?: number | null;
  maxFileSize?: number | null;
  allowedFileTypes?: string | null;
  password?: string;
  pageLayout?: PageLayout;
  backgroundImageId?: string | null;
  nameFieldRequired?: FieldRequirement;
  emailFieldRequired?: FieldRequirement;
}

export interface UpdateReverseShareBody {
  id: string;
  name?: string;
  description?: string;
  expiration?: string;
  maxFiles?: number | null;
  maxFileSize?: number | null;
  allowedFileTypes?: string | null;
  password?: string | null;
  pageLayout?: PageLayout;
  backgroundImageId?: string | null;
  isActive?: boolean;
  nameFieldRequired?: FieldRequirement;
  emailFieldRequired?: FieldRequirement;
}

export interface UpdateReverseSharePasswordBody {
  password: string | null;
}

export interface GetPresignedUrlBody {
  filename: string;
  extension: string;
}

export interface RegisterFileUploadBody {
  name: string;
  description?: string;
  extension: string;
  size: number;
  objectName: string;
  uploaderEmail?: string;
  uploaderName?: string;
}

export interface GetReverseShareForUploadParams {
  password?: string;
}

export interface UpdateReverseShareFileBody {
  name?: string;
  description?: string | null;
}

export interface RegisterFileUploadParams {
  password?: string;
}

export type CreateReverseShareResult = AxiosResponse<CreateReverseShare201>;
export type UpdateReverseShareResult = AxiosResponse<UpdateReverseShare200>;
export type ListUserReverseSharesResult = AxiosResponse<ListUserReverseShares200>;
export type DeleteReverseShareResult = AxiosResponse<DeleteReverseShare200>;
export type GetReverseShareForUploadResult = AxiosResponse<GetReverseShareForUpload200>;
export type UpdateReverseSharePasswordResult = AxiosResponse<UpdateReverseSharePassword200>;
export type GetPresignedUrlResult = AxiosResponse<GetPresignedUrl200>;
export type RegisterFileUploadResult = AxiosResponse<RegisterFileUpload201>;
export type UpdateReverseShareFileResult = AxiosResponse<UpdateReverseShareFile200>;

export interface CopyReverseShareFile200 {
  file: {
    id: string;
    name: string;
    description: string | null;
    extension: string;
    size: string;
    objectName: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
  };
  message: string;
}
export type CopyReverseShareFileResult = AxiosResponse<CopyReverseShareFile200>;

export interface CreateReverseShareAlias200 {
  id: string;
  alias: string;
  reverseShareId: string;
  createdAt: string;
  updatedAt: string;
}
export type CreateReverseShareAliasResult = AxiosResponse<CreateReverseShareAlias200>;

export interface DeleteReverseShareFileResult200 {
  message: string;
}
export type DeleteReverseShareFileByIdResult = AxiosResponse<DeleteReverseShareFileResult200>;

export interface CreateMultipartUpload200 {
  uploadId: string;
  objectName: string;
  message: string;
}
export type CreateMultipartUploadByAliasResult = AxiosResponse<CreateMultipartUpload200>;

export interface GetMultipartPartUrl200 {
  url: string;
}
export type GetMultipartPartUrlByAliasResult = AxiosResponse<GetMultipartPartUrl200>;

export interface CompleteMultipartUpload200 {
  message: string;
  objectName: string;
}
export type CompleteMultipartUploadByAliasResult = AxiosResponse<CompleteMultipartUpload200>;

export interface AbortMultipartUpload200 {
  message: string;
}
export type AbortMultipartUploadByAliasResult = AxiosResponse<AbortMultipartUpload200>;

export interface ListMultipartPartsByAlias200 {
  parts: Array<{
    PartNumber: number;
    Size: number;
    ETag: string;
  }>;
}
export type ListMultipartPartsByAliasResult = AxiosResponse<ListMultipartPartsByAlias200>;
