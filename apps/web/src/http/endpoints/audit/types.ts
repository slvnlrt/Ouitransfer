import type { AxiosResponse } from "axios";

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  ipAddress: string;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
}

export interface AuditLogsParams {
  userId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditExportParams {
  format: "csv" | "json";
  userId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  dateFrom: string;
  dateTo: string;
  search?: string;
}

export type GetAuditLogsResult = AxiosResponse<AuditLogsResponse>;
