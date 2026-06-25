/**
 * Union of all notification type keys used across server and client.
 *
 * Derived from the server's `notificationCatalog` keys in
 * `apps/server/src/modules/email/catalog.ts`. When adding a new notification
 * type to the catalog, add it here as well — TypeScript will surface any
 * frontend code that doesn't handle the new type.
 */
export type NotificationType =
  // Account lifecycle (critical, non-configurable)
  | "welcome"
  | "password_reset"
  | "account_deactivated"
  | "account_reactivated"
  // Share invitations (non-configurable)
  | "share_invitation"
  | "reverse_share_invitation"
  // Share activity (configurable)
  | "share_accessed"
  | "share_downloaded"
  // Share lifecycle (configurable)
  | "share_expiring"
  | "share_expired"
  | "share_pending_deletion"
  | "share_max_views_reached"
  | "share_no_activity"
  // Reverse share lifecycle (configurable)
  | "reverse_share_uploaded"
  | "reverse_share_expiring"
  | "reverse_share_expired"
  | "reverse_share_pending_deletion"
  | "reverse_share_auto_deleted"
  // Quota & cleanup (configurable)
  | "quota_warning"
  | "quota_exceeded"
  | "files_auto_deleted"
  | "share_auto_deleted"
  // Admin notifications (configurable)
  | "admin_user_registered"
  | "admin_quota_alert"
  // System / testing (critical)
  | "test_email";
