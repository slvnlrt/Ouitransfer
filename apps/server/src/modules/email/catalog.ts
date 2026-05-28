import { z } from "zod";

import type { TranslationFn } from "./i18n/loader.js";
import type { LayoutSlots } from "./templates/base-layout.js";

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
  /** i18n keys required by the render function. Empty until Batch 6. */
  requiredI18nKeys: string[];
}

// ─── Stub render (replaced in Batch 6 with real templates) ────────────────────

const stubRender = (_data: unknown, _t: TranslationFn): LayoutSlots => ({
  subtitle: "Email",
  body: "<p>Placeholder</p>",
});

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
  expiresAt: z.string().optional(),
});

const reverseShareInvitationSchema = z.object({
  senderName: z.string(),
  reverseShareName: z.string(),
  reverseShareLink: z.string(),
  hasPassword: z.boolean(),
  expiresAt: z.string().optional(),
});

const shareAccessedSchema = z.object({
  shareName: z.string(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  ipAddress: z.string().optional(),
  accessedAt: z.string(),
});

const shareDownloadedSchema = z.object({
  shareName: z.string(),
  fileName: z.string(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().optional(),
  ipAddress: z.string().optional(),
  downloadedAt: z.string(),
});

const shareExpiringSchema = z.object({
  shareName: z.string(),
  expiresAt: z.string(),
  shareManageUrl: z.string(),
});

const shareExpiredSchema = z.object({
  shareName: z.string(),
  expiredAt: z.string(),
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
  fileNames: z.array(z.string()),
  uploaderName: z.string().optional(),
  uploaderEmail: z.string().optional(),
});

const reverseShareExpiringSchema = z.object({
  reverseShareName: z.string(),
  expiresAt: z.string(),
});

const reverseShareExpiredSchema = z.object({
  reverseShareName: z.string(),
  expiredAt: z.string(),
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
    render: stubRender,
    payloadSchema: welcomeSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  password_reset: {
    render: stubRender,
    payloadSchema: passwordResetSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  account_deactivated: {
    render: stubRender,
    payloadSchema: accountDeactivatedSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  account_reactivated: {
    render: stubRender,
    payloadSchema: accountReactivatedSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  // ── Share invitations (non-configurable, one-shot) ─────────────────────────

  share_invitation: {
    render: stubRender,
    payloadSchema: shareInvitationSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  reverse_share_invitation: {
    render: stubRender,
    payloadSchema: reverseShareInvitationSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
  },

  // ── Share activity (configurable, noisy) ───────────────────────────────────

  share_accessed: {
    render: stubRender,
    payloadSchema: shareAccessedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "disabled",
    configurable: true,
    hasUnsubscribe: true,
    cooldownSeconds: 900,
    requiredI18nKeys: [],
  },

  share_downloaded: {
    render: stubRender,
    payloadSchema: shareDownloadedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "disabled",
    configurable: true,
    hasUnsubscribe: true,
    cooldownSeconds: 900,
    requiredI18nKeys: [],
  },

  // ── Share lifecycle (configurable) ─────────────────────────────────────────

  share_expiring: {
    render: stubRender,
    payloadSchema: shareExpiringSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  share_expired: {
    render: stubRender,
    payloadSchema: shareExpiredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  share_max_views_reached: {
    render: stubRender,
    payloadSchema: shareMaxViewsReachedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  share_no_activity: {
    render: stubRender,
    payloadSchema: shareNoActivitySchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  // ── Reverse share lifecycle (configurable) ─────────────────────────────────

  reverse_share_uploaded: {
    render: stubRender,
    payloadSchema: reverseShareUploadedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  reverse_share_expiring: {
    render: stubRender,
    payloadSchema: reverseShareExpiringSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  reverse_share_expired: {
    render: stubRender,
    payloadSchema: reverseShareExpiredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  // ── Quota & cleanup (configurable) ─────────────────────────────────────────

  quota_warning: {
    render: stubRender,
    payloadSchema: quotaWarningSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  quota_exceeded: {
    render: stubRender,
    payloadSchema: quotaExceededSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  files_auto_deleted: {
    render: stubRender,
    payloadSchema: filesAutoDeletedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  share_auto_deleted: {
    render: stubRender,
    payloadSchema: shareAutoDeletedSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  // ── Admin notifications (configurable) ─────────────────────────────────────

  admin_user_registered: {
    render: stubRender,
    payloadSchema: adminUserRegisteredSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  admin_quota_alert: {
    render: stubRender,
    payloadSchema: adminQuotaAlertSchema,
    priority: 0,
    isCritical: false,
    defaultFrequency: "immediate",
    configurable: true,
    hasUnsubscribe: true,
    requiredI18nKeys: [],
  },

  // ── System / testing (critical) ────────────────────────────────────────────

  test_email: {
    render: stubRender,
    payloadSchema: testEmailSchema,
    priority: 1,
    isCritical: true,
    defaultFrequency: "immediate",
    configurable: false,
    hasUnsubscribe: false,
    requiredI18nKeys: [],
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
