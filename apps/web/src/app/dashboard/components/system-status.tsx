"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  HardDrive,
  MonitorDown,
  RefreshCw,
  Share2,
  Users,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { ErrorDisplay } from "@/components/error-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { AdminStats200 } from "@/http/endpoints/admin/types";
import type { CheckHealth200, DiskSpaceInfo, HealthStatus200 } from "@/http/endpoints/app/types";
import { useSystemStatus } from "../hooks/use-system-status";
import { formatStorageSize } from "../utils/format-storage-size";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: "healthy" | "degraded" | "unhealthy";
  label: string;
}) {
  const colorMap = {
    healthy: {
      text: "text-green-600 dark:text-green-400",
      dot: "bg-green-500",
    },
    degraded: {
      text: "text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    unhealthy: {
      text: "text-red-600 dark:text-red-400",
      dot: "bg-red-500",
    },
  };

  const colors = colorMap[status];

  return (
    <span className={`flex items-center gap-1.5 text-sm font-medium ${colors.text}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Quota Display ─────────────────────────────────────────────────────────────

function QuotaDisplay({ diskSpace }: { diskSpace: DiskSpaceInfo }) {
  const t = useTranslations("dashboard.systemStatus.quota");

  // Unlimited: no progress bar, just show usage
  if (diskSpace.diskAvailableGB === -1 || diskSpace.diskSizeGB === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("label")}</span>
          <span className="text-muted-foreground">{t("unlimited")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("usedOnly", { used: formatStorageSize(diskSpace.diskUsedGB) })}
        </p>
      </div>
    );
  }

  const percentage = diskSpace.percentage ?? 0;
  const warningLevel = diskSpace.warningLevel ?? "none";

  const progressClassName: Record<string, string> = {
    none: "",
    warning: "[&>div]:bg-yellow-500",
    critical: "[&>div]:bg-orange-500",
    exceeded: "[&>div]:bg-red-500",
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("label")}</span>
        <span className="tabular-nums text-muted-foreground">{percentage}%</span>
      </div>
      <Progress
        value={Math.min(percentage, 100)}
        className={`w-full h-2 ${progressClassName[warningLevel] ?? ""}`}
        aria-label={t("ariaLabel")}
      />
      <p className="text-xs text-muted-foreground">
        {t("used", {
          used: formatStorageSize(diskSpace.diskUsedGB),
          total: formatStorageSize(diskSpace.diskSizeGB),
        })}
      </p>
    </div>
  );
}

// ── User View ────────────────────────────────────────────────────────────────

function UserView({
  healthStatus,
  healthStatusLoading,
  healthStatusError,
  isRefreshing,
  fileCount,
  activeShareCount,
  diskSpace,
  diskSpaceLoading,
  refresh,
}: {
  healthStatus: HealthStatus200 | null;
  healthStatusLoading: boolean;
  healthStatusError: string | null;
  isRefreshing: boolean;
  fileCount?: number;
  activeShareCount?: number;
  diskSpace: DiskSpaceInfo | null;
  diskSpaceLoading: boolean;
  refresh: () => void;
}) {
  const t = useTranslations("dashboard.systemStatus");

  // Loading skeleton
  if (healthStatusLoading) {
    return (
      <Card className="w-full">
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="h-8 bg-muted rounded animate-pulse" />
            <Separator />
            <div className="h-6 bg-muted rounded animate-pulse" />
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-6 bg-muted rounded animate-pulse" />
              <div className="h-6 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (healthStatusError) {
    return (
      <Card className="w-full">
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Activity className="text-muted-foreground size-6" />
                {t("title")}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={refresh}
                disabled={isRefreshing}
                aria-label={t("refresh")}
              >
                <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <ErrorDisplay
              variant="inline"
              title={t("errors.title")}
              message={t("errors.fetchFailed")}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  const status = healthStatus?.status ?? "healthy";

  const statusLabelMap = {
    healthy: t("status.healthy"),
    degraded: t("status.degraded"),
    unhealthy: t("status.unhealthy"),
  };

  return (
    <Card className="w-full">
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Status band */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="text-muted-foreground size-5" aria-hidden="true" />
              <span className="font-semibold">{t("title")}</span>
            </div>
            <StatusBadge status={status} label={statusLabelMap[status]} />
          </div>

          <Separator />

          {/* Quota warning banner */}
          {diskSpace?.warningLevel === "exceeded" && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive font-medium">{t("quota.exceeded.banner")}</p>
            </div>
          )}
          {(diskSpace?.warningLevel === "warning" || diskSpace?.warningLevel === "critical") && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                {t("quota.warning.banner", { percentage: diskSpace.percentage ?? 0 })}
              </p>
            </div>
          )}

          {/* Quota display */}
          {diskSpace ? (
            <QuotaDisplay diskSpace={diskSpace} />
          ) : diskSpaceLoading ? (
            <div className="h-12 bg-muted rounded animate-pulse" />
          ) : null}

          <Separator />

          {/* Personal metrics */}
          <div className="grid grid-cols-2 gap-4">
            <MetricRow
              icon={FileText}
              label={t("metrics.myFiles")}
              value={fileCount !== undefined ? String(fileCount) : "—"}
            />
            <MetricRow
              icon={Share2}
              label={t("metrics.activeShares")}
              value={activeShareCount !== undefined ? String(activeShareCount) : "—"}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Admin View ───────────────────────────────────────────────────────────────

function getStorageStatusDisplay(
  storageStatus: "ok" | "error" | "not_configured",
  t: (key: string) => string,
) {
  switch (storageStatus) {
    case "ok":
      return {
        icon: <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />,
        className: "text-green-600 dark:text-green-400",
        label: t("checks.ok"),
      };
    case "not_configured":
      return {
        icon: <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />,
        className: "text-amber-600 dark:text-amber-400",
        label: t("checks.notConfigured"),
      };
    case "error":
      return {
        icon: <XCircle className="size-3.5 text-red-600 dark:text-red-400" />,
        className: "text-red-600 dark:text-red-400",
        label: t("checks.error"),
      };
  }
}

function AdminView({
  healthData,
  healthLoading,
  healthError,
  diskSpace,
  diskSpaceLoading,
  diskSpaceError,
  adminStats,
  adminStatsLoading,
  adminStatsError,
  isRefreshing,
  refresh,
}: {
  healthData: CheckHealth200 | null;
  healthLoading: boolean;
  healthError: boolean;
  diskSpace: DiskSpaceInfo | null;
  diskSpaceLoading: boolean;
  diskSpaceError: string | null;
  adminStats: AdminStats200 | null;
  adminStatsLoading: boolean;
  adminStatsError: string | null;
  isRefreshing: boolean;
  refresh: () => void;
}) {
  const t = useTranslations("dashboard.systemStatus");

  // Loading skeleton
  if (healthLoading || diskSpaceLoading || adminStatsLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-5" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
            <Separator />
            <div className="h-3 bg-muted rounded animate-pulse" />
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state (health fetch failed)
  if (healthError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-5" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorDisplay
            variant="inline"
            title={t("errors.title")}
            message={t("errors.fetchFailed")}
            actions={[{ label: t("refresh"), onClick: refresh, variant: "outline" }]}
          />
        </CardContent>
      </Card>
    );
  }

  // Derive status
  const isHealthy = healthData?.status === "healthy";
  const dbOk = healthData?.checks.database === "ok";
  const storageOk =
    healthData?.checks.storage === "ok" || healthData?.checks.storage === "not_configured";

  const overallStatus: "healthy" | "degraded" | "unhealthy" = isHealthy
    ? "healthy"
    : dbOk || storageOk
      ? "degraded"
      : "unhealthy";

  const statusLabelMap = {
    healthy: t("status.healthy"),
    degraded: t("status.degraded"),
    unhealthy: t("status.unhealthy"),
  };

  // Disk space calculation
  const diskUsagePercent = diskSpace
    ? Math.round((diskSpace.diskUsedGB / (diskSpace.diskSizeGB || 1)) * 100)
    : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-5" />
            {t("title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <StatusBadge status={overallStatus} label={statusLabelMap[overallStatus]} />
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={isRefreshing}
              aria-label={t("refresh")}
            >
              <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Health checks */}
          {healthData && (
            <div className="flex flex-col gap-2">
              {/* Database */}
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Database className="size-4" aria-hidden="true" />
                  {t("checks.database")}
                </span>
                <span className="flex items-center gap-1">
                  {dbOk ? (
                    <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
                  )}
                  <span
                    className={
                      dbOk ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }
                  >
                    {dbOk ? t("checks.ok") : t("checks.error")}
                  </span>
                </span>
              </div>

              {/* Storage */}
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <HardDrive className="size-4" aria-hidden="true" />
                  {t("checks.storage")}
                </span>
                {(() => {
                  const display = getStorageStatusDisplay(healthData.checks.storage, t);
                  return (
                    <span className="flex items-center gap-1">
                      {display.icon}
                      <span className={display.className}>{display.label}</span>
                    </span>
                  );
                })()}
              </div>

              {/* Uptime */}
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <MonitorDown className="size-4" aria-hidden="true" />
                  {t("uptime")}
                </span>
                <span className="tabular-nums">{formatUptime(healthData.uptime)}</span>
              </div>
            </div>
          )}

          <Separator />

          {/* Disk space */}
          {diskSpaceError ? (
            <p className="text-sm text-destructive">{t("errors.diskSpaceError")}</p>
          ) : diskSpace ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("diskSpace.label")}</span>
                <span className="tabular-nums">{diskUsagePercent}%</span>
              </div>
              <Progress
                value={diskUsagePercent}
                className="w-full h-2"
                aria-label={t("diskSpace.ariaLabel")}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatStorageSize(diskSpace.diskUsedGB)} /{" "}
                {formatStorageSize(diskSpace.diskSizeGB)}
              </p>
            </div>
          ) : diskSpaceLoading ? (
            <div className="h-8 bg-muted rounded animate-pulse" />
          ) : null}

          <Separator />

          {/* Platform metrics */}
          {adminStatsError ? (
            <p className="text-sm text-destructive">{t("errors.statsError")}</p>
          ) : adminStats ? (
            <div className="grid grid-cols-2 gap-3">
              <MetricRow
                icon={Users}
                label={t("metrics.users")}
                value={`${adminStats.users.active} / ${adminStats.users.total}`}
              />
              <MetricRow
                icon={FileText}
                label={t("metrics.files")}
                value={String(adminStats.files.total)}
              />
              <MetricRow
                icon={Share2}
                label={t("metrics.shares")}
                value={`${adminStats.shares.active} • ${adminStats.shares.expired}`}
              />
              <MetricRow
                icon={Share2}
                label={t("metrics.reverseShares")}
                value={String(adminStats.reverseShares.active)}
              />
            </div>
          ) : adminStatsLoading ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SystemStatus({
  fileCount,
  activeShareCount,
}: {
  fileCount?: number;
  activeShareCount?: number;
} = {}) {
  const status = useSystemStatus();

  if (status.isAdmin) {
    return (
      <AdminView
        healthData={status.healthData}
        healthLoading={status.healthLoading}
        healthError={status.healthError}
        diskSpace={status.diskSpace}
        diskSpaceLoading={status.diskSpaceLoading}
        diskSpaceError={status.diskSpaceError}
        adminStats={status.adminStats}
        adminStatsLoading={status.adminStatsLoading}
        adminStatsError={status.adminStatsError}
        isRefreshing={status.isRefreshing}
        refresh={status.refresh}
      />
    );
  }

  return (
    <UserView
      healthStatus={status.healthStatus}
      healthStatusLoading={status.healthStatusLoading}
      healthStatusError={status.healthStatusError}
      isRefreshing={status.isRefreshing}
      fileCount={fileCount}
      activeShareCount={activeShareCount}
      diskSpace={status.diskSpace}
      diskSpaceLoading={status.diskSpaceLoading}
      refresh={status.refresh}
    />
  );
}
