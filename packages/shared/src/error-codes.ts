/**
 * Centralized error code registry.
 * Shared between server and frontend via @ouitransfer/shared/error-codes.
 *
 * Convention: SCREAMING_SNAKE_CASE, value === key.
 * Add new codes here — never use ad-hoc string literals.
 */
export const ErrorCodes = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  // The requested change (demote / deactivate / delete) would remove the last
  // remaining active admin, or an admin attempted to lock themselves out of
  // their own account in the same request (A2-02).
  LAST_ADMIN: "LAST_ADMIN",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",

  // Abuse / throttling. Raised by application-level anti-spam guards (e.g. the
  // per-user outbound-email quota / burst cap, A6-03) — distinct from the global
  // HTTP rate-limit plugin, which does not carry an ErrorCode.
  RATE_LIMITED: "RATE_LIMITED",

  // Resources
  NOT_FOUND: "NOT_FOUND",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  CONFLICT: "CONFLICT",
  GONE: "GONE",
  BACKGROUND_IMAGE_NOT_FOUND: "BACKGROUND_IMAGE_NOT_FOUND",

  // Database
  UNIQUE_CONSTRAINT: "UNIQUE_CONSTRAINT",
  FOREIGN_KEY_CONSTRAINT: "FOREIGN_KEY_CONSTRAINT",
  RELATION_VIOLATION: "RELATION_VIOLATION",
  DATABASE_ERROR: "DATABASE_ERROR",

  // Storage
  STORAGE_UNREACHABLE: "STORAGE_UNREACHABLE",
  DISK_SPACE_DETECTION_FAILED: "DISK_SPACE_DETECTION_FAILED",
  DISK_SPACE_ERROR: "DISK_SPACE_ERROR",
  FILE_SIZE_EXCEEDED: "FILE_SIZE_EXCEEDED",
  INSUFFICIENT_STORAGE: "INSUFFICIENT_STORAGE",

  // System
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RESPONSE_SERIALIZATION_ERROR: "RESPONSE_SERIALIZATION_ERROR",
  FASTIFY_ERROR: "FASTIFY_ERROR",
  COPY_FAILED: "COPY_FAILED",

  // Shares
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  // Too many failed password attempts against a (reverse-)share; the password gate is
  // temporarily locked (per-share brute-force protection — R2 A4-03).
  SHARE_LOCKED: "SHARE_LOCKED",
  SHARE_EXPIRED: "SHARE_EXPIRED",
  MAX_VIEWS_REACHED: "MAX_VIEWS_REACHED",
  SHARE_INACTIVE: "SHARE_INACTIVE",
  IDENTIFICATION_REQUIRED: "IDENTIFICATION_REQUIRED",
  // The share/reverse-share owner's account is deactivated, so the resource is
  // no longer publicly accessible (read-time gate, auto-reverses on reactivation).
  OWNER_INACTIVE: "OWNER_INACTIVE",

  // Upload
  UPLOAD_FAILED: "UPLOAD_FAILED",

  // LDAP
  LDAP_SYNC_IN_PROGRESS: "LDAP_SYNC_IN_PROGRESS",
  LDAP_CONFIG_NOT_FOUND: "LDAP_CONFIG_NOT_FOUND",
  LDAP_CONNECTION_FAILED: "LDAP_CONNECTION_FAILED",

  // Invites
  INVITE_TOKEN_USED: "INVITE_TOKEN_USED",
  INVITE_TOKEN_EXPIRED: "INVITE_TOKEN_EXPIRED",
  // The registrant's email does not match the address the email-bound invite was
  // issued to (A6-04). Open/bearer invites (no bound email) never raise this.
  INVITE_EMAIL_MISMATCH: "INVITE_EMAIL_MISMATCH",
  USERNAME_EXISTS: "USERNAME_EXISTS",
  EMAIL_EXISTS: "EMAIL_EXISTS",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
