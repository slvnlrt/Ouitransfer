import { prisma } from "../../shared/prisma.js";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "TWO_FACTOR_ENABLE"
  | "TWO_FACTOR_DISABLE"
  | "ADMIN_CONFIG_CHANGE"
  | "USER_CREATE"
  | "USER_DELETE"
  | "ACCOUNT_LOCKED";

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
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: Array<Record<string, unknown>>; total: number }> {
  const where = {
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.action ? { action: params.action } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs: logs as unknown as Array<Record<string, unknown>>, total };
}
