import type { AxiosResponse } from "axios";

export interface FileSizeInfo {
  bytes: number;
  kb: number;
  mb: number;
  gb: number;
}

export interface DiskSpaceInfo {
  diskSizeGB: number;
  diskUsedGB: number;
  diskAvailableGB: number;
  uploadAllowed: boolean;
  warningLevel?: "none" | "warning" | "critical" | "exceeded";
  maxFileSize?: number;
  percentage?: number;
}

export type EmailHealthStatus = "ok" | "disabled" | "degraded" | "down";

/**
 * Public liveness probe response (GET /health). A8-11: coarse aggregate only —
 * the per-subsystem breakdown is NOT exposed unauthenticated. HTTP status is 200
 * when alive, 503 when the database is down.
 */
export interface CheckHealth200 {
  status: "healthy" | "degraded";
  timestamp: string;
  uptime: number;
}

export interface CheckUploadAllowed200 extends DiskSpaceInfo {
  fileSizeInfo: FileSizeInfo;
}

export type GetDiskSpace200 = DiskSpaceInfo;

export interface GetAppInfo200 {
  appName: string;
  appDescription: string;
  appLogo: string;
  firstUserAccess: boolean;
}

export interface RemoveLogo200 {
  message: string;
}

export interface UploadLogo200 {
  logo: string;
}

export interface CheckUploadAllowedParams {
  fileSize: string;
}

export interface UploadLogoBody {
  file?: unknown;
}

/**
 * Detailed health response (GET /health/status). A8-11: requires an authenticated
 * session (any logged-in user) — exposes the per-subsystem breakdown (which
 * backend is degraded) so it must never be reachable unauthenticated, but it is
 * not admin-restricted (it powers the user-facing email/notifications indicator).
 */
export interface HealthStatus200 {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  checks: {
    database: "ok" | "error";
    storage: "ok" | "error" | "not_configured";
    email: EmailHealthStatus;
  };
}

export type HealthStatusResult = AxiosResponse<HealthStatus200>;
export type GetAppInfoResult = AxiosResponse<GetAppInfo200>;
export type UploadLogoResult = AxiosResponse<UploadLogo200>;
export type RemoveLogoResult = AxiosResponse<RemoveLogo200>;
export type CheckHealthResult = AxiosResponse<CheckHealth200>;
export type GetDiskSpaceResult = AxiosResponse<GetDiskSpace200>;
export type CheckUploadAllowedResult = AxiosResponse<CheckUploadAllowed200>;
