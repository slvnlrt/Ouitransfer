import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type { AuditExportParams, AuditLogsParams, GetAuditLogsResult } from "./types";

export const getAuditLogs = (
  params: AuditLogsParams,
  options?: AxiosRequestConfig,
): Promise<GetAuditLogsResult> => {
  return apiInstance.get("/api/admin/audit-logs", { params, ...options });
};

export const exportAuditLogs = (params: AuditExportParams): string => {
  const searchParams = new URLSearchParams();
  searchParams.set("format", params.format);
  searchParams.set("dateFrom", params.dateFrom);
  searchParams.set("dateTo", params.dateTo);
  if (params.userId) searchParams.set("userId", params.userId);
  if (params.action) searchParams.set("action", params.action);
  if (params.targetType) searchParams.set("targetType", params.targetType);
  if (params.targetId) searchParams.set("targetId", params.targetId);
  if (params.search) searchParams.set("search", params.search);
  return `/api/admin/audit-logs/export?${searchParams.toString()}`;
};
