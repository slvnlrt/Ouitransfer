import { z } from "zod";
import type { TranslationFn } from "./i18n/loader.js";
import { validateI18nKeys } from "./i18n/loader.js";

/**
 * Strict ISO 8601 datetime string validation.
 * Accepts `2026-01-01T00:00:00Z` and `2026-01-01T00:00:00+05:30` but rejects
 * date-only strings and ambiguous formats that `Date.parse` would accept.
 * All callers pass `.toISOString()` which always produces the required format.
 */
const isoDateString = z.string().datetime({ offset: true });

import { renderAccountDeactivated } from "./templates/account-deactivated.js";
import { renderAccountReactivated } from "./templates/account-reactivated.js";
import { renderAdminQuotaAlert } from "./templates/admin-quota-alert.js";
import { renderAdminUserRegistered } from "./templates/admin-user-registered.js";
import type { LayoutSlots } from "./templates/base-layout.js";
import { renderFilesAutoDeleted } from "./templates/files-auto-deleted.js";
import { renderPasswordReset } from "./templates/password-reset.js";
import { renderQuotaExceeded } from "./templates/quota-exceeded.js";
import { renderQuotaWarning } from "./templates/quota-warning.js";
import { renderReverseShareAutoDeleted } from "./templates/reverse-share-auto-deleted.js";
import { renderReverseShareExpired } from "./templates/reverse-share-expired.js";
import { renderReverseShareExpiring } from "./templates/reverse-share-expiring.js";
import { renderReverseShareInvitation } from "./templates/reverse-share-invitation.js";
import { renderReverseSharePendingDeletion } from "./templates/reverse-share-pending-deletion.js";
import { renderReverseShareUploaded } from "./templates/reverse-share-uploaded.js";
import { renderShareAccessed } from "./templates/share-accessed.js";
import { renderShareAutoDeleted } from "./templates/share-auto-deleted.js";
import { renderShareDownloaded } from "./templates/share-downloaded.js";
import { renderShareExpired } from "./templates/share-expired.js";
import { renderShareExpiring } from "./templates/share-expiring.js";
import { renderShareInvitation } from "./templates/share-invitation.js";
import { renderShareMaxViewsReached } from "./templates/share-max-views-reached.js";
import { renderShareNoActivity } from "./templates/share-no-activity.js";
import { renderSharePendingDeletion } from "./templates/share-pending-deletion.js";
import { renderTestEmail } from "./templates/test-email.js";
import { renderWelcome } from "./templates/welcome.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationTypeConfig {
  /** Renders the email body slots from typed payload data + i18n function. */
  render: (data: unknown, t: TranslationFn) => LayoutSlots;
  /** Zod schema that validates the payload for this notification type. */
  payloadSchema: z.ZodType;
  /** 0 = normal (batched poll), 1 = high-priority (immediate wake). */
  priority: 0 | 1;
  /** Critical emails bypass user preference checks entirely. */
  isCritical: boolean;
  /** Default frequency when no user preference row exists. */
  defaultFrequency: "immediate" | "disabled";
  /** Whether the user can change the frequency for this type. */
  configurable: boolean;
  /** Whether to include an unsubscribe link in the email footer. */
  hasUnsubscribe: boolean;
  /** Optional dedup window in seconds (e.g. 900 for share_accessed). */
  cooldownSeconds?: number;
  /** i18n keys required by the render function. */
  requiredI18nKeys: string[];
  /** Human-readable display name for this notification type (shown in unsubscribe pages). */
  displayName: string;
}

// ─── Render adapter ───────────────────────────────────────────────────────────

/**
 * Casts a strongly-typed render function to the `(data: unknown) => LayoutSlots`
 * signature required by `NotificationTypeConfig.render`.
 *
 * This is safe at runtime: the catalog's Zod `payloadSchema` validates each
 * payload before `render()` is ever called, so the typed function always
 * receives a correctly-shaped object.
 */
function asRender<T>(
  fn: (data: T, t: TranslationFn) => LayoutSlots,
): (data: unknown, t: TranslationFn) => LayoutSlots {
  // biome-ignore lint/suspicious/noExplicitAny: necessary to bridge strongly-typed render fns to the unknown-data interface contract; Zod validates the payload before render() is called
  return fn as (data: any, t: TranslationFn) => LayoutSlots;
}

// ─── Payload schemas ──────────────────────────────────────────────────────────

const welcomeSchema = z.object({
  firstName: z.string(),
  loginUrl: z.string(),
});

const passwordResetSchema = z.object({
  resetUrl: z.string(),
  expiresInMinutes: z.number(),
});

const accountDeactivatedSchema = z.object({
  firstName: z.string(),
  adminContactEmail: z.string().email().optional(),
});

const accountReactivatedSchema = z.object({
  firstName: z.string(),
  loginUrl: z.string(),
});

const shareInvitationSchema = z.object({
  senderName: z.string(),
  shareName: z.string(),
  shareLink: z.string(),
  hasPassword: z.boolean(),
  expiresAt: isoDateString.optional(),
});

const reverseShareInvitationSchema = z.object({
  senderName: z.string(),
  reverseShareName: z.string(),
  reverseShareLink: z.string(),
  hasPassword: z.boolean(),
  expiresAt: isoDateString.optional(),
});

const shareAccessedSchema = z.object({
  shareName: z.string(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  accessedAt: isoDateString,
  shareManageUrl: z.string().optional(),
});

const shareDownloadedSchema = z.object({
  shareName: z.string(),
  fileName: z.string(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  downloadedAt: isoDateString,
  shareManageUrl: z.string().optional(),
});

const shareExpiringSchema = z.object({
  shareName: z.string(),
  expiresAt: isoDateString,
  shareManageUrl: z.string(),
});

const shareExpiredSchema = z.object({
  shareName: z.string(),
  expiredAt: isoDateString,
  shareManageUrl: z.string(),
});

const sharePendingDeletionSchema = z.object({
  shareName: z.string(),
  deletionAt: isoDateString,
  shareManageUrl: z.string(),
});

const shareMaxViewsReachedSchema = z.object({
  shareName: z.string(),
  maxViews: z.number(),
  shareManageUrl: z.string(),
});

const shareNoActivitySchema = z.object({
  shareName: z.string(),
  inactivityDays: z.number(),
  shareManageUrl: z.string(),
});

const reverseShareUploadedSchema = z.object({
  reverseShareName: z.string(),
  fileCount: z.number(),
  fileNames: z.array(z.string()).min(1),
  uploaderName: z.string().optional(),
  uploaderEmail: z.string().optional(),
});

const reverseShareExpiringSchema = z.object({
  reverseShareName: z.string(),
  expiresAt: isoDateString,
});

const reverseShareExpiredSchema = z.object({
  reverseShareName: z.string(),
  expiredAt: isoDateString,
});

const reverseSharePendingDeletionSchema = z.object({
  reverseShareName: z.string(),
  deletionAt: isoDateString,
  reverseShareManageUrl: z.string(),
});

const reverseShareAutoDeletedSchema = z.object({
  reverseShareName: z.string(),
  deletedAt: isoDateString,
});

const quotaWarningSchema = z.object({
  usedPercent: z.number(),
  usedBytes: z.number(),
  maxBytes: z.number(),
});

const quotaExceededSchema = z.object({
  usedBytes: z.number(),
  maxBytes: z.number(),
  gracePeriodDays: z.number().optional(),
});

const filesAutoDeletedSchema = z.object({
  fileNames: z.array(z.string()),
  reason: z.string(),
});

const shareAutoDeletedSchema = z.object({
  shareName: z.string(),
  reason: z.string(),
});

const adminUserRegisteredSchema = z.object({
  userName: z.string(),
  userEmail: z.string(),
  registrationMethod: z.string(),
});

const adminQuotaAlertSchema = z.object({
  userName: z.string(),
  userEmail: z.string(),
  usedPercent: z.number(),
  usedBytes: z.number(),
  maxBytes: z.number(),
});

const testEmailSchema = z.object({
  testMessage: z.string().optional(),
});

// ─── Notification catalog ─────────────────────────────────────────────────────

export const notificationCatalog = {
  // ── Account lifecycle (critical, non-configurable) ─────────────────────────

  welcome: {
    render: asRender(renderWelcome),
    payloadSchema: welcomeSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: ["welcome.subject", "welcome.subtitle", "welcome.body", "welcome.cta"],
    displayName: "Welcome",
  },

  password_reset: {
    render: asRender(renderPasswordReset),
    payloadSchema: passwordResetSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "passwordReset.subject",
      "passwordReset.subtitle",
      "passwordReset.body",
      "passwordReset.cta",
      "passwordReset.info",
    ],
    displayName: "Password Reset",
  },

  account_deactivated: {
    render: asRender(renderAccountDeactivated),
    payloadSchema: accountDeactivatedSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "accountDeactivated.subject",
      "accountDeactivated.subtitle",
      "accountDeactivated.body",
      "accountDeactivated.info",
      "accountDeactivated.infoContact",
    ],
    displayName: "Account Deactivated",
  },

  account_reactivated: {
    render: asRender(renderAccountReactivated),
    payloadSchema: accountReactivatedSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "accountReactivated.subject",
      "accountReactivated.subtitle",
      "accountReactivated.body",
      "accountReactivated.cta",
    ],
    displayName: "Account Reactivated",
  },

  // ── Share invitations (non-configurable, one-shot) ─────────────────────────

  share_invitation: {
    render: asRender(renderShareInvitation),
    payloadSchema: shareInvitationSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "shareInvitation.subject",
      "shareInvitation.subtitle",
      "shareInvitation.body",
      "shareInvitation.cta",
      "shareInvitation.info",
      "shareInvitation.infoPassword",
      "shareInvitation.infoExpires",
      "shareInvitation.infoPasswordExpires",
    ],
    displayName: "Share Invitations",
  },

  // DEFERRED: Reverse shares do not have a recipient model. Trigger will be added
  // when reverse share invitations are implemented. See features/specs/8.2-email-notifications.md.
  reverse_share_invitation: {
    render: asRender(renderReverseShareInvitation),
    payloadSchema: reverseShareInvitationSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "reverseShareInvitation.subject",
      "reverseShareInvitation.subtitle",
      "reverseShareInvitation.body",
      "reverseShareInvitation.cta",
      "reverseShareInvitation.info",
      "reverseShareInvitation.infoPassword",
      "reverseShareInvitation.infoExpires",
      "reverseShareInvitation.infoPasswordExpires",
    ],
    displayName: "Reverse Share Invitations",
  },

  // ── Share activity (configurable, noisy) ───────────────────────────────────

  share_accessed: {
    render: asRender(renderShareAccessed),
    payloadSchema: shareAccessedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "disabled",
    configurable: true,
    hasUnsubscribe: true,
    cooldownSeconds: 900,
    requiredI18nKeys: [
      "shareAccessed.subject",
      "shareAccessed.subtitle",
      "shareAccessed.bodyIdentified",
      "shareAccessed.bodyAnonymous",
    ],
    displayName: "Share Access Notifications",
  },

  /**
   * Cooldown is per-share (not per-file). A single notification is sent for the share
   * regardless of how many individual files are downloaded within the cooldown window.
   *
   * Fired from file/routes.ts:trackShareDownload on non-owner file downloads.
   */
  share_downloaded: {
    render: asRender(renderShareDownloaded),
    payloadSchema: shareDownloadedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "disabled",
    configurable: true,
    hasUnsubscribe: true,
    cooldownSeconds: 900,
    requiredI18nKeys: [
      "shareDownloaded.subject",
      "shareDownloaded.subtitle",
      "shareDownloaded.bodyIdentified",
      "shareDownloaded.bodyAnonymous",
    ],
    displayName: "Share Download Notifications",
  },

  // ── Share lifecycle (configurable) ─────────────────────────────────────────

  share_expiring: {
    render: asRender(renderShareExpiring),
    payloadSchema: shareExpiringSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "shareExpiring.subject",
      "shareExpiring.subtitle",
      "shareExpiring.body",
      "shareExpiring.cta",
    ],
    displayName: "Share Expiring Soon",
  },

  share_expired: {
    render: asRender(renderShareExpired),
    payloadSchema: shareExpiredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "shareExpired.subject",
      "shareExpired.subtitle",
      "shareExpired.body",
      "shareExpired.cta",
    ],
    displayName: "Share Expired",
  },

  share_pending_deletion: {
    render: asRender(renderSharePendingDeletion),
    payloadSchema: sharePendingDeletionSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "sharePendingDeletion.subject",
      "sharePendingDeletion.subtitle",
      "sharePendingDeletion.body",
      "sharePendingDeletion.cta",
      "sharePendingDeletion.info",
    ],
    displayName: "Share Pending Deletion",
  },

  share_max_views_reached: {
    render: asRender(renderShareMaxViewsReached),
    payloadSchema: shareMaxViewsReachedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "shareMaxViewsReached.subject",
      "shareMaxViewsReached.subtitle",
      "shareMaxViewsReached.body",
      "shareMaxViewsReached.cta",
    ],
    displayName: "Share Max Views Reached",
  },

  share_no_activity: {
    render: asRender(renderShareNoActivity),
    payloadSchema: shareNoActivitySchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "shareNoActivity.subject",
      "shareNoActivity.subtitle",
      "shareNoActivity.body",
      "shareNoActivity.cta",
    ],
    displayName: "Share No Activity Alert",
  },

  // ── Reverse share lifecycle (configurable) ─────────────────────────────────

  reverse_share_uploaded: {
    render: asRender(renderReverseShareUploaded),
    payloadSchema: reverseShareUploadedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "disabled",
    configurable: true,
    hasUnsubscribe: true,
    // Prevent flooding from script-driven upload bursts (5-minute cooldown).
    // The 5-second debounce in upload.service.ts batches files from a single upload session.
    // The 300-second cooldown here prevents notification flooding from multiple rapid upload
    // sessions to the same reverse share.
    cooldownSeconds: 300,
    requiredI18nKeys: [
      "reverseShareUploaded.subject",
      "reverseShareUploaded.subtitle",
      "reverseShareUploaded.bodyIdentified",
      "reverseShareUploaded.bodyAnonymous",
    ],
    displayName: "Reverse Share Upload Notifications",
  },

  reverse_share_expiring: {
    render: asRender(renderReverseShareExpiring),
    payloadSchema: reverseShareExpiringSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "reverseShareExpiring.subject",
      "reverseShareExpiring.subtitle",
      "reverseShareExpiring.body",
    ],
    displayName: "Reverse Share Expiring Soon",
  },

  reverse_share_expired: {
    render: asRender(renderReverseShareExpired),
    payloadSchema: reverseShareExpiredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "reverseShareExpired.subject",
      "reverseShareExpired.subtitle",
      "reverseShareExpired.body",
    ],
    displayName: "Reverse Share Expired",
  },

  reverse_share_pending_deletion: {
    render: asRender(renderReverseSharePendingDeletion),
    payloadSchema: reverseSharePendingDeletionSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "reverseSharePendingDeletion.subject",
      "reverseSharePendingDeletion.subtitle",
      "reverseSharePendingDeletion.body",
      "reverseSharePendingDeletion.cta",
      "reverseSharePendingDeletion.info",
    ],
    displayName: "Reverse Share Pending Deletion",
  },

  reverse_share_auto_deleted: {
    render: asRender(renderReverseShareAutoDeleted),
    payloadSchema: reverseShareAutoDeletedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "reverseShareAutoDeleted.subject",
      "reverseShareAutoDeleted.subtitle",
      "reverseShareAutoDeleted.body",
      "reverseShareAutoDeleted.info",
    ],
    displayName: "Reverse Share Auto-Deleted",
  },

  // ── Quota & cleanup (configurable) ─────────────────────────────────────────

  quota_warning: {
    render: asRender(renderQuotaWarning),
    payloadSchema: quotaWarningSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "quotaWarning.subject",
      "quotaWarning.subtitle",
      "quotaWarning.body",
      "quotaWarning.info",
    ],
    displayName: "Storage Quota Warning",
  },

  quota_exceeded: {
    render: asRender(renderQuotaExceeded),
    payloadSchema: quotaExceededSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "quotaExceeded.subject",
      "quotaExceeded.subtitle",
      "quotaExceeded.body",
      "quotaExceeded.bodyGrace",
      "quotaExceeded.info",
    ],
    displayName: "Storage Quota Exceeded",
  },

  files_auto_deleted: {
    render: asRender(renderFilesAutoDeleted),
    payloadSchema: filesAutoDeletedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "filesAutoDeleted.subject",
      "filesAutoDeleted.subtitle",
      "filesAutoDeleted.body",
      "filesAutoDeleted.info",
    ],
    displayName: "Files Auto-Deleted",
  },

  share_auto_deleted: {
    render: asRender(renderShareAutoDeleted),
    payloadSchema: shareAutoDeletedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "shareAutoDeleted.subject",
      "shareAutoDeleted.subtitle",
      "shareAutoDeleted.body",
      "shareAutoDeleted.info",
    ],
    displayName: "Share Auto-Deleted",
  },

  // ── Admin notifications (configurable) ─────────────────────────────────────

  admin_user_registered: {
    render: asRender(renderAdminUserRegistered),
    payloadSchema: adminUserRegisteredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "adminUserRegistered.subject",
      "adminUserRegistered.subtitle",
      "adminUserRegistered.body",
    ],
    displayName: "New User Registration (Admin)",
  },

  admin_quota_alert: {
    render: asRender(renderAdminQuotaAlert),
    payloadSchema: adminQuotaAlertSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [
      "adminQuotaAlert.subject",
      "adminQuotaAlert.subtitle",
      "adminQuotaAlert.body",
      "adminQuotaAlert.info",
    ],
    displayName: "User Quota Alert (Admin)",
  },

  // ── System / testing (critical) ────────────────────────────────────────────

  test_email: {
    render: asRender(renderTestEmail),
    payloadSchema: testEmailSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [
      "testEmail.subject",
      "testEmail.subtitle",
      "testEmail.body",
      "testEmail.bodyCustom",
      "testEmail.info",
    ],
    displayName: "Test Email",
  },
} as const satisfies Record<string, NotificationTypeConfig>;

// ─── Derived types ────────────────────────────────────────────────────────────

/** Union of all notification type keys. */
export type NotificationKey = keyof typeof notificationCatalog;

/**
 * Mapped type: for each notification key, the inferred TypeScript type
 * of its Zod payload schema. Used to type-check `send()` calls.
 */
export type EmailPayloads = {
  [K in NotificationKey]: z.infer<(typeof notificationCatalog)[K]["payloadSchema"]>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a snake_case notification type key to its camelCase i18n prefix.
 *
 * @example typeToI18nPrefix("share_invitation") // "shareInvitation"
 * @example typeToI18nPrefix("welcome")          // "welcome"
 */
export function typeToI18nPrefix(type: NotificationKey): string {
  return type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Validates that all i18n keys required by the notification catalog exist in en.json.
 * Call this on boot to catch missing translations early.
 *
 * @throws Error listing all missing keys.
 */
export async function validateAllI18nKeys(): Promise<void> {
  const allKeys = Object.values(notificationCatalog).flatMap((c) => c.requiredI18nKeys);
  await validateI18nKeys([...new Set(allKeys)]);
}
