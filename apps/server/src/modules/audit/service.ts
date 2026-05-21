import { z } from "zod";
import type { AuditLog } from "../../generated/prisma/client.js";

import { prisma } from "../../shared/prisma.js";

/** Typed union of all supported audit actions. */
const AUDIT_ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "LOGOUT",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
  "TWO_FACTOR_ENABLE",
  "TWO_FACTOR_DISABLE",
  "ADMIN_CONFIG_CHANGE",
  "USER_CREATE",
  "USER_DELETE",
  // ACCOUNT_LOCKED: emitted by login-attempts.service when the lockout threshold is reached
  // LOGIN_LOCKED: emitted by auth/controller when a login attempt is made while already locked
  "ACCOUNT_LOCKED",
  "LOGIN_LOCKED",
] as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export async function logAuditEvent(params: {
  userId?: string;
  action: AuditAction;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}

export async function getAuditLogs(params: {
  userId?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}): Promise<{ logs: (Omit<AuditLog, "metadata"> & { metadata: unknown })[]; total: number }> {
  const where = {
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.action ? { action: params.action } : {}),
  };

  const [rawLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Parse metadata JSON strings into objects for the API response.
  // If parsing fails, fall back to the raw string (defensive — logs are internal data).
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
