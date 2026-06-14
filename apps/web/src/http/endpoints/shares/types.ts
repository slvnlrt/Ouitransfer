import type { AxiosResponse } from "axios";

export type ShareAlias = {
  id: string;
  alias: string;
  shareId: string;
  createdAt: string;
  updatedAt: string;
} | null;

export interface ShareFile {
  id: string;
  name: string;
  description: string | null;
  extension: string;
  size: string;
  /**
   * Download handle. For NON-OWNER (public) share responses this is an OPAQUE per-share file
   * token (R2 — A4-08), not the raw storage key; the client passes it back verbatim to the
   * download endpoints. For owner responses it is the real S3 objectName.
   */
  objectName: string;
  /** Owner user id — blank ("") in non-owner responses (R2 — A4-08), the real id for owners. */
  userId: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareFolder {
  id: string;
  name: string;
  description: string | null;
  /** Empty ("") in non-owner responses (R2 — A4-08). */
  objectName: string;
  /** Blank ("") in non-owner responses (R2 — A4-08). */
  userId: string;
  parentId: string | null;
  totalSize: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    files: number;
    children: number;
  };
}

export interface ShareRecipient {
  id: string;
  email: string;
  name: string | null;
  trackingToken: string | null;
  notifiedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  /** Number of files this recipient has downloaded (counts files, not sessions). */
  downloadCount: number;
  /** When this recipient last downloaded a file, or null if never. Drives the download-status badge. */
  lastDownloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareSecurity {
  hasPassword: boolean;
}

/**
 * Full share object returned by the API.
 *
 * **Server redaction for non-owner responses**: When the requesting user is NOT
 * the share creator, the server zeroes/empties several owner-only fields:
 * - `recipients` → empty array
 * - `nameFieldRequired` / `emailFieldRequired` → default "HIDDEN"
 * - `notifyOnDownload` → false
 * - `inactivityAlertDays` → null
 * - `lastDownloadedAt` → null
 * - `notifiedForExpiring` / `notifiedForExpired` → false
 *
 * These fields are only meaningful in owner contexts (dashboard, share details modal).
 * The type keeps them non-optional for simplicity since they always exist on the wire.
 */
export interface Share {
  id: string;
  name: string | null;
  description: string | null;
  expiration: string | null;
  views: number;
  maxViews: number | null;
  createdAt: string;
  updatedAt: string;
  creatorId: string | null;
  security: ShareSecurity;
  files: ShareFile[];
  folders: ShareFolder[];
  recipients: ShareRecipient[];
  alias: ShareAlias | null;
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  notifyOnDownload: boolean;
  inactivityAlertDays: number | null;
  lastDownloadedAt: string | null;
  notifiedForExpiring: boolean;
  notifiedForExpired: boolean;
  /** Lifecycle (Phase A.1): false when the share is deactivated/paused. */
  isActive: boolean;
  /** When the share was deactivated, or null while active. */
  deactivatedAt: string | null;
  /** Why the share was deactivated: "expired" | "max_views" | "manual" (null while active). */
  deactivationReason: "expired" | "max_views" | "manual" | null;
}

export interface CreateShare201 {
  share: Share;
}

export interface UpdateShare200 {
  share: Share;
}

export interface UpdateSharePassword200 {
  share: Share;
}

export interface GetShare200 {
  share: Share;
}

export interface GetShareByAlias200 {
  share: Share;
}

export interface DeleteShare200 {
  share: Share;
}

export interface PauseShare200 {
  share: Share;
}

export interface ResumeShare200 {
  share: Share;
}

export interface RemoveRecipients200 {
  share: Share;
}

export interface RemoveFiles200 {
  share: Share;
}

export interface AddRecipients200 {
  share: Share;
}

export interface AddFiles200 {
  share: Share;
}

export interface ListUserShares200 {
  shares: Share[];
}

export interface CreateShareAlias200 {
  alias: {
    id: string;
    alias: string;
    shareId: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface NotifyRecipients200 {
  message: string;
  notifiedRecipients: string[];
}

export interface RemindNonDownloaders200 {
  remindedRecipients: string[];
}

export interface AddFolders200 {
  share: Share;
}

export interface RemoveFolders200 {
  share: Share;
}

export interface CreateShareBody {
  name?: string;
  description?: string;
  expiration?: string;
  files?: string[];
  folders?: string[];
  password?: string;
  maxViews?: number | null;
  recipients?: string[];
  nameFieldRequired?: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired?: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  notifyOnDownload?: boolean;
  inactivityAlertDays?: number | null;
}

export interface UpdateShareBody {
  id: string;
  name?: string;
  description?: string;
  expiration?: string;
  password?: string;
  maxViews?: number | null;
  recipients?: string[];
  nameFieldRequired?: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired?: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  notifyOnDownload?: boolean;
  inactivityAlertDays?: number | null;
}

export interface UpdateSharePasswordBody {
  password: string | null;
}

export interface AddFilesBody {
  files: string[];
}

export interface RemoveFilesBody {
  files: string[];
}

export interface RecipientInput {
  email: string;
  name?: string | null;
}

export interface AddRecipientsBody {
  emails?: string[];
  recipients?: RecipientInput[];
}

export interface RemoveRecipientsBody {
  emails: string[];
}

export interface CreateShareAliasBody {
  alias: string;
}

export interface NotifyRecipientsBody {
  emails?: string[];
}

export interface RemindNonDownloadersBody {
  emails?: string[];
}

export interface GetShareParams {
  password?: string;
}

export interface GetShareByAliasParams {
  password?: string;
}

// ── Share visits ────────────────────────────────────────────────────────
export interface ShareVisit {
  id: string;
  action: string;
  visitorName: string | null;
  visitorEmail: string | null;
  createdAt: string;
  recipientId: string | null;
  shareId: string;
  fileId: string | null;
  recipient: { email: string; name: string | null } | null;
  identificationSource: "tracking_token" | "cookie" | "anonymous" | "authenticated_user";
  isOwner: boolean;
}

export interface GetShareVisits200 {
  visits: ShareVisit[];
  total: number;
  page: number;
  limit: number;
}

// ── Visitor identification ─────────────────────────────────────────────
export interface IdentifyVisitorBody {
  name?: string;
  email?: string;
}

export interface IdentifyVisitor200 {
  success: boolean;
}

// ── Share metadata (extended) ──────────────────────────────────────────
export interface ShareMetadata {
  /** Null for closed (expired/maxed/paused/inactive) shares — the name is withheld (R2 A4-06). */
  name: string | null;
  /** Null for closed shares (R2 A4-06). */
  description: string | null;
  totalFiles: number;
  totalFolders: number;
  hasPassword: boolean;
  /** False when the share is paused/deactivated (R2 A4-06). */
  isActive: boolean;
  isExpired: boolean;
  isMaxViewsReached: boolean;
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
}

export type GetShareMetadata200 = ShareMetadata;

export type CreateShareResult = AxiosResponse<CreateShare201>;
export type UpdateShareResult = AxiosResponse<UpdateShare200>;
export type ListUserSharesResult = AxiosResponse<ListUserShares200>;
export type GetShareResult = AxiosResponse<GetShare200>;
export type DeleteShareResult = AxiosResponse<DeleteShare200>;
export type PauseShareResult = AxiosResponse<PauseShare200>;
export type ResumeShareResult = AxiosResponse<ResumeShare200>;
export type UpdateSharePasswordResult = AxiosResponse<UpdateSharePassword200>;
export type AddFilesResult = AxiosResponse<AddFiles200>;
export type RemoveFilesResult = AxiosResponse<RemoveFiles200>;
export type AddRecipientsResult = AxiosResponse<AddRecipients200>;
export type RemoveRecipientsResult = AxiosResponse<RemoveRecipients200>;
export type CreateShareAliasResult = AxiosResponse<CreateShareAlias200>;
export type GetShareByAliasResult = AxiosResponse<GetShareByAlias200>;
export type NotifyRecipientsResult = AxiosResponse<NotifyRecipients200>;
export type RemindNonDownloadersResult = AxiosResponse<RemindNonDownloaders200>;
export type AddFoldersResult = AxiosResponse<AddFolders200>;
export type RemoveFoldersResult = AxiosResponse<RemoveFolders200>;
export type GetShareVisitsResult = AxiosResponse<GetShareVisits200>;
export type IdentifyVisitorResult = AxiosResponse<IdentifyVisitor200>;
export type GetShareMetadataResult = AxiosResponse<GetShareMetadata200>;
