import { z } from "zod";
import type { AuditLog } from "../../generated/prisma/client.js";

import { prisma } from "../../shared/prisma.js";

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
  "SHARE_PASSWORD_UPDATE",
  "SHARE_RECIPIENT_ADD",
  "SHARE_RECIPIENT_REMOVE",
  "SHARE_RECIPIENT_NOTIFY",
  "SHARE_ITEMS_ADD",
  "SHARE_ITEMS_REMOVE",
  // File
  "FILE_UPLOAD",
  "FILE_DOWNLOAD",
  "FILE_DELETE",
  "FILE_MOVE",
  "FILE_UPDATE",
  "FILE_EMBED_ACCESS",
  // Folder
  "FOLDER_CREATE",
  "FOLDER_UPDATE",
  "FOLDER_MOVE",
  "FOLDER_DELETE",
  // Reverse share
  "REVERSE_SHARE_CREATE",
  "REVERSE_SHARE_UPDATE",
  "REVERSE_SHARE_DELETE",
  "REVERSE_SHARE_ACTIVATE",
  "REVERSE_SHARE_DEACTIVATE",
  "REVERSE_SHARE_ACCESS",
  "REVERSE_SHARE_PASSWORD_VERIFIED",
  "REVERSE_SHARE_PASSWORD_FAILED",
  "REVERSE_SHARE_PASSWORD_UPDATE",
  "REVERSE_SHARE_UPLOAD",
  "REVERSE_SHARE_FILE_DELETE",
  "REVERSE_SHARE_FILE_COPY",
  "REVERSE_SHARE_FILE_DOWNLOAD",
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

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_DENYLIST.has(key)) {
      sanitized[key] = value;
    }
  }
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
      return { ...log, metadata: log.metadata };
    }
  });

  return { logs, total };
}

// ── Export ────────────────────────────────────────────────────────────────────

const EXPORT_BATCH_SIZE = 1000;
const EXPORT_MAX_ROWS = 100_000;

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
    yield "id,userId,action,ipAddress,userAgent,targetType,targetId,metadata,createdAt\n";

    while (totalExported < EXPORT_MAX_ROWS) {
      const batch = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - totalExported),
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const log of batch) {
        const metadataStr = log.metadata ? `"${log.metadata.replace(/"/g, '""')}"` : "";
        yield `${log.id},${log.userId ?? ""},${log.action},${log.ipAddress},${(log.userAgent ?? "").replace(/,/g, " ")},${log.targetType ?? ""},${log.targetId ?? ""},${metadataStr},${log.createdAt.toISOString()}\n`;
      }

      totalExported += batch.length;
      cursor = batch[batch.length - 1]!.id;

      if (batch.length < EXPORT_BATCH_SIZE) break;
    }
  } else {
    // JSON format
    yield "[";
    let isFirst = true;

    while (totalExported < EXPORT_MAX_ROWS) {
      const batch = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
  }
}

// ── Retention ────────────────────────────────────────────────────────────────

const DELETE_BATCH_SIZE = 1000;

export async function deleteOldAuditLogs(olderThan: Date): Promise<number> {
  let totalDeleted = 0;
  let batchDeleted: number;

  do {
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    batchDeleted = result.count;
    totalDeleted += batchDeleted;
  } while (batchDeleted >= DELETE_BATCH_SIZE);

  return totalDeleted;
}
