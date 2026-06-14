import { z } from "zod";
import type { AuditLog } from "../../generated/prisma/client.js";

import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";

// ── Action enum ──────────────────────────────────────────────────────────────

const AUDIT_ACTIONS = [
  // Auth
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "LOGOUT",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
  "PASSWORD_RESET_REQUEST",
  "ACCOUNT_LOCKED",
  "LOGIN_LOCKED",
  "TRUSTED_DEVICE_REMOVE",
  "TRUSTED_DEVICE_REMOVE_ALL",
  "AUTH_PROVIDER_LOGIN",
  // Two-factor
  "TWO_FACTOR_ENABLE",
  "TWO_FACTOR_DISABLE",
  "TWO_FACTOR_BACKUP_REGENERATED",
  // User
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DELETE",
  "USER_ROLE_CHANGE",
  "USER_QUOTA_CHANGE",
  "USER_ACTIVATE",
  "USER_DEACTIVATE",
  // Share
  "SHARE_CREATE",
  "SHARE_UPDATE",
  "SHARE_DELETE",
  "SHARE_ACCESS",
  "SHARE_PASSWORD_VERIFIED",
  "SHARE_PASSWORD_FAILED",
  "SHARE_PASSWORD_LOCKED",
  "SHARE_PASSWORD_UPDATE",
  "SHARE_RECIPIENT_ADD",
  "SHARE_RECIPIENT_REMOVE",
  "SHARE_RECIPIENT_NOTIFY",
  "SHARE_RECIPIENT_REMIND",
  "SHARE_ITEMS_ADD",
  "SHARE_ITEMS_REMOVE",
  "SHARE_DEACTIVATED",
  "SHARE_REACTIVATED",
  // File
  "FILE_UPLOAD",
  "FILE_DOWNLOAD",
  "FILE_DELETE",
  "FILE_MOVE",
  "FILE_UPDATE",
  // Folder
  "FOLDER_CREATE",
  "FOLDER_UPDATE",
  "FOLDER_MOVE",
  "FOLDER_DELETE",
  // Reverse share
  "REVERSE_SHARE_CREATE",
  "REVERSE_SHARE_UPDATE",
  "REVERSE_SHARE_DELETE",
  "REVERSE_SHARE_DEACTIVATED",
  "REVERSE_SHARE_REACTIVATED",
  "REVERSE_SHARE_ACCESS",
  "REVERSE_SHARE_PASSWORD_VERIFIED",
  "REVERSE_SHARE_PASSWORD_FAILED",
  "REVERSE_SHARE_PASSWORD_LOCKED",
  "REVERSE_SHARE_PASSWORD_UPDATE",
  "REVERSE_SHARE_UPLOAD",
  "REVERSE_SHARE_FILE_DELETE",
  "REVERSE_SHARE_FILE_COPY",
  "REVERSE_SHARE_FILE_DOWNLOAD",
  "REVERSE_SHARE_RECIPIENT_ADD",
  "REVERSE_SHARE_RECIPIENT_REMOVE",
  "REVERSE_SHARE_RECIPIENT_NOTIFY",
  // Group
  "GROUP_CREATE",
  "GROUP_UPDATE",
  "GROUP_DELETE",
  "GROUP_MEMBER_ADD",
  "GROUP_MEMBER_REMOVE",
  // LDAP
  "LDAP_CONFIG_UPDATE",
  "LDAP_SYNC_TRIGGERED",
  "LDAP_SYNC_COMPLETED",
  "LDAP_SYNC_ERROR",
  // Auth providers
  "AUTH_PROVIDER_CREATE",
  "AUTH_PROVIDER_UPDATE",
  "AUTH_PROVIDER_DELETE",
  // Invite
  "INVITE_TOKEN_CREATE",
  "INVITE_TOKEN_USED",
  // App / Admin
  "ADMIN_CONFIG_CHANGE",
  "LOGO_UPLOAD",
  "LOGO_REMOVE",
  "SMTP_TEST",
  // Background image
  "BACKGROUND_IMAGE_UPLOAD",
  "BACKGROUND_IMAGE_DELETE",
  // System
  "AUDIT_RETENTION_CLEANUP",
  // Lifecycle cleanup (5.2)
  "SHARE_AUTO_DELETED",
  "REVERSE_SHARE_AUTO_DELETED",
  "ACCOUNT_FILES_CLEANED",
  "ORPHAN_S3_DELETED",
  "ORPHAN_DB_DELETED",
  "ORPHAN_MULTIPART_ABORTED",
  "QUOTA_FILES_DELETED",
] as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

// ── Target type enum ─────────────────────────────────────────────────────────

const AUDIT_TARGET_TYPES = [
  "user",
  "share",
  "reverse_share",
  "file",
  "folder",
  "group",
  "ldap_config",
  "ldap_sync_log",
  "setting",
  "auth_provider",
  "background_image",
  "invite_token",
  "trusted_device",
  "logo",
] as const;

export const AuditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

// ── Safety guards ────────────────────────────────────────────────────────────

/** Keys stripped from metadata before persistence. */
const METADATA_DENYLIST = new Set([
  "password",
  "token",
  "secret",
  "bindPassword",
  "clientSecret",
  "smtpPass",
  "twoFactorSecret",
  "twoFactorBackupCodes",
  "currentPassword",
  "newPassword",
  "confirmPassword",
]);

const MAX_USER_AGENT_LENGTH = 512;

function deepSanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (METADATA_DENYLIST.has(key)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = deepSanitize(value as Record<string, unknown>);
      if (Object.keys(nested).length > 0) result[key] = nested;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const sanitized = deepSanitize(metadata);
  return Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : null;
}

function capUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  return userAgent.length > MAX_USER_AGENT_LENGTH
    ? userAgent.slice(0, MAX_USER_AGENT_LENGTH)
    : userAgent;
}

// ── Core functions ───────────────────────────────────────────────────────────

export async function logAuditEvent(params: {
  userId?: string;
  action: AuditAction;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  targetType?: AuditTargetType;
  targetId?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      ipAddress: params.ipAddress,
      userAgent: capUserAgent(params.userAgent),
      metadata: sanitizeMetadata(params.metadata),
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
    },
  });
}

export async function getAuditLogs(params: {
  userId?: string;
  action?: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  logs: (Omit<AuditLog, "metadata"> & { metadata: unknown })[];
  total: number;
}> {
  const where: Record<string, unknown> = {};

  if (params.userId) where.userId = params.userId;
  if (params.action) where.action = params.action;
  if (params.targetType) where.targetType = params.targetType;
  if (params.targetId) where.targetId = params.targetId;

  if (params.dateFrom || params.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (params.dateFrom) createdAt.gte = params.dateFrom;
    if (params.dateTo) createdAt.lte = params.dateTo;
    where.createdAt = createdAt;
  }

  if (params.search) {
    where.OR = [
      { ipAddress: { contains: params.search } },
      { action: { contains: params.search } },
    ];
  }

  const [rawLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const logs = rawLogs.map((log) => {
    if (log.metadata === null) {
      return { ...log, metadata: null };
    }
    try {
      return { ...log, metadata: JSON.parse(log.metadata) as unknown };
    } catch {
      getLogger().warn({ logId: log.id }, "Failed to parse audit log metadata");
      return { ...log, metadata: null };
    }
  });

  return { logs, total };
}

// ── Export ────────────────────────────────────────────────────────────────────

const EXPORT_BATCH_SIZE = 1000;
const EXPORT_MAX_ROWS = 100_000;

/** RFC 4180 — wrap field in double-quotes if it contains special characters. */
function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function* exportAuditLogs(params: {
  format: "csv" | "json";
  userId?: string;
  action?: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}): AsyncGenerator<string> {
  if (!params.dateFrom || !params.dateTo) {
    throw new Error("dateFrom and dateTo are required for export");
  }

  const where: Record<string, unknown> = {};
  if (params.userId) where.userId = params.userId;
  if (params.action) where.action = params.action;
  if (params.targetType) where.targetType = params.targetType;
  if (params.targetId) where.targetId = params.targetId;

  const createdAt: Record<string, Date> = {};
  createdAt.gte = params.dateFrom;
  createdAt.lte = params.dateTo;
  where.createdAt = createdAt;

  if (params.search) {
    where.OR = [
      { ipAddress: { contains: params.search } },
      { action: { contains: params.search } },
    ];
  }

  let cursor: string | undefined;
  let totalExported = 0;

  if (params.format === "csv") {
    // UTF-8 BOM for Excel compatibility (FIX 5)
    yield "\uFEFF";
    yield "id,userId,action,ipAddress,userAgent,targetType,targetId,metadata,createdAt\n";

    while (totalExported < EXPORT_MAX_ROWS) {
      const batch = await prisma.auditLog.findMany({
        where,
        // Compound orderBy: break createdAt ties by id to avoid skipping rows (FIX 3)
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - totalExported),
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const log of batch) {
        const fields = [
          log.id,
          log.userId ?? "",
          log.action,
          log.ipAddress,
          log.userAgent ?? "",
          log.targetType ?? "",
          log.targetId ?? "",
          log.metadata ?? "",
          log.createdAt.toISOString(),
        ];
        yield `${fields.map(csvField).join(",")}\n`;
      }

      totalExported += batch.length;
      cursor = batch[batch.length - 1]!.id;

      if (batch.length < EXPORT_BATCH_SIZE) break;
    }

    if (totalExported >= EXPORT_MAX_ROWS) {
      yield `# Export truncated at ${EXPORT_MAX_ROWS} rows. Refine your date range for complete data.\n`;
    }
  } else {
    // JSON format
    yield "[";
    let isFirst = true;

    while (totalExported < EXPORT_MAX_ROWS) {
      const batch = await prisma.auditLog.findMany({
        where,
        // Compound orderBy: break createdAt ties by id to avoid skipping rows (FIX 3)
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - totalExported),
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const log of batch) {
        const entry = {
          ...log,
          metadata: log.metadata ? JSON.parse(log.metadata) : null,
          createdAt: log.createdAt.toISOString(),
        };
        yield `${isFirst ? "" : ","}${JSON.stringify(entry)}`;
        isFirst = false;
      }

      totalExported += batch.length;
      cursor = batch[batch.length - 1]!.id;

      if (batch.length < EXPORT_BATCH_SIZE) break;
    }

    yield "]";

    if (totalExported >= EXPORT_MAX_ROWS) {
      getLogger().warn(
        { totalExported, maxRows: EXPORT_MAX_ROWS },
        "Audit export truncated at row limit",
      );
    }
  }
}

// ── Retention ────────────────────────────────────────────────────────────────

const DELETE_BATCH_SIZE = 1000;

/**
 * Delete audit logs older than the given date in real batches.
 *
 * Prisma's `deleteMany` has no LIMIT — it deletes everything matching in one
 * statement. We use `$executeRawUnsafe` with a subquery-based LIMIT so each
 * iteration truly deletes at most DELETE_BATCH_SIZE rows.
 *
 * Note: the SQLite column name is `createdAt` (no @map in schema).
 */
export async function deleteOldAuditLogs(olderThan: Date): Promise<number> {
  let totalDeleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE "createdAt" < ? LIMIT ?)`,
      olderThan.toISOString(),
      DELETE_BATCH_SIZE,
    );
    totalDeleted += deleted;
    if (deleted < DELETE_BATCH_SIZE) break;
  }

  return totalDeleted;
}

/** Placeholder written in place of a redacted email in audit metadata. */
export const REDACTED_EMAIL = "[deleted]";

/**
 * Recursively replaces every string value exactly equal to `email` with the
 * redaction placeholder. Returns the (possibly new) value and whether anything
 * changed. Non-matching values are returned unchanged (same reference).
 */
function redactEmailDeep(value: unknown, email: string): { value: unknown; changed: boolean } {
  if (value === email) {
    return { value: REDACTED_EMAIL, changed: true };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = redactEmailDeep(item, email);
      changed ||= result.changed;
      return result.value;
    });
    return changed ? { value: next, changed } : { value, changed: false };
  }

  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const result = redactEmailDeep(item, email);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return changed ? { value: next, changed } : { value, changed: false };
  }

  return { value, changed: false };
}

/**
 * Redacts an email from existing audit log metadata (GDPR erasure).
 *
 * Recipient emails are persisted in plaintext in `AuditLog.metadata` (e.g.
 * `metadata.emails` from share recipients, `metadata.email` from auth/invite
 * events). When a user is deleted, this replaces every exact occurrence of
 * their email — anywhere in the metadata JSON — with {@link REDACTED_EMAIL},
 * preserving the audit trail structure (counts, actions, ids) while removing
 * the PII.
 *
 * `metadata` is a JSON string, so a substring `contains` filter narrows the
 * candidate set before parsing; the deep walk then redacts only exact matches.
 *
 * Returns the number of audit rows updated.
 */
export async function redactEmailFromAuditLogs(email: string): Promise<number> {
  if (!email) return 0;

  const candidates = await prisma.auditLog.findMany({
    where: { metadata: { contains: email } },
    select: { id: true, metadata: true },
  });

  let updated = 0;
  for (const row of candidates) {
    if (!row.metadata) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.metadata);
    } catch {
      getLogger().warn({ logId: row.id }, "Skipping unparseable audit metadata during redaction");
      continue;
    }

    const { value, changed } = redactEmailDeep(parsed, email);
    if (!changed) continue;

    await prisma.auditLog.update({
      where: { id: row.id },
      data: { metadata: JSON.stringify(value) },
    });
    updated++;
  }

  return updated;
}
