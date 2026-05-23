"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { ErrorDisplay } from "@/components/error-display";
import { Progress } from "@/components/ui/progress";
import { useDashboardMetrics } from "@/contexts/dashboard-metrics-context";
import { useSystemStatus } from "@/hooks/use-system-status";
import type { AdminStats200 } from "@/http/endpoints/admin/types";
import type { CheckHealth200, DiskSpaceInfo } from "@/http/endpoints/app/types";
import { formatStorageSize } from "@/utils/format-storage-size";

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

type OverallStatus = "healthy" | "degraded" | "unhealthy";

const STATUS_COLORS: Record<
  OverallStatus,
  { dot: string; glow: string; text: string; border: string }
> = {
  healthy: {
    dot: "bg-green-500",
    glow: "shadow-[0_0_6px_rgba(34,197,94,0.6)]",
    text: "text-green-600 dark:text-green-400",
    border: "",
  },
  degraded: {
    dot: "bg-amber-500",
    glow: "shadow-[0_0_6px_rgba(245,158,11,0.6)]",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30",
  },
  unhealthy: {
    dot: "bg-red-500",
    glow: "shadow-[0_0_6px_rgba(239,68,68,0.6)]",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/30",
  },
};

const PULSE_CLASSES: Partial<Record<OverallStatus, string>> = {
  degraded: "animate-[pulse_2s_ease-in-out_infinite]",
  unhealthy: "animate-[pulse_1.5s_ease-in-out_infinite]",
};

// ── Glassmorphism classes ────────────────────────────────────────────────────

const GLASS_TAB =
  "bg-gradient-to-r from-background/30 via-background/75 to-background/30 backdrop-blur-xl border border-white/5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]";

const GLASS_PANEL =
  "bg-gradient-to-r from-background/30 via-background/75 to-background/30 backdrop-blur-xl border-x border-b border-white/5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]";

// ── Collapsed Tab ────────────────────────────────────────────────────────────

function CollapsedTab({
  status,
  isLoading,
  quotaPercentage,
  warningLevel,
  onToggle,
}: {
  status: OverallStatus;
  isLoading: boolean;
  quotaPercentage?: number;
  warningLevel?: string;
  onToggle: () => void;
}) {
  const t = useTranslations("dashboard.systemStatus");
  const colors = isLoading ? null : STATUS_COLORS[status];
  const pulseClass = isLoading ? "" : (PULSE_CLASSES[status] ?? "");
  const showQuotaBadge =
    !isLoading &&
    quotaPercentage !== undefined &&
    warningLevel &&
    ["warning", "critical", "exceeded"].includes(warningLevel);

  return (
    <div className="flex justify-center pointer-events-none">
      <button
        type="button"
        onClick={onToggle}
        className={`${GLASS_TAB} rounded-b-lg px-4 py-1.5 flex items-center gap-2 cursor-pointer pointer-events-auto transition-colors hover:bg-background/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${!isLoading ? colors!.border : ""}`}
        aria-expanded={false}
        aria-controls="system-status-panel"
        aria-label={t("expand")}
      >
        {/* Status dot */}
        <span
          className={`inline-block size-2 rounded-full ${
            isLoading ? "bg-muted-foreground/40" : `${colors!.dot} ${colors!.glow} ${pulseClass}`
          }`}
          aria-hidden="true"
        />

        {/* Title */}
        <span
          className={`text-xs font-medium ${
            isLoading
              ? "text-muted-foreground/60"
              : status === "healthy"
                ? "text-muted-foreground"
                : colors!.text
          }`}
        >
          {t("title")}
        </span>

        {/* Quota badge */}
        {showQuotaBadge && (
          <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
            {quotaPercentage}%
          </span>
        )}

        {/* Chevron */}
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Compact Progress Bar ─────────────────────────────────────────────────────

function CompactProgressBar({
  label,
  percentage,
  used,
  total,
  ariaLabel,
  warningLevel,
}: {
  label: string;
  percentage: number;
  used: string;
  total: string;
  ariaLabel: string;
  warningLevel?: "none" | "warning" | "critical" | "exceeded";
}) {
  type WarningLevel = "none" | "warning" | "critical" | "exceeded";

  const progressClassName: Record<WarningLevel, string> = {
    none: "",
    warning: "[&>div]:bg-yellow-500",
    critical: "[&>div]:bg-orange-500",
    exceeded: "[&>div]:bg-red-500",
  };

  return (
    <div className="flex flex-col gap-1 min-w-[160px] flex-1">
      {/* Label shows real percentage (can exceed 100% for exceeded quotas); bar caps at 100 */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{percentage}%</span>
      </div>
      <Progress
        value={Math.min(percentage, 100)}
        className={`w-full h-1.5 ${progressClassName[warningLevel ?? "none"] ?? ""}`}
        aria-label={ariaLabel}
      />
      <p className="text-[10px] text-muted-foreground tabular-nums">
        {used} / {total}
      </p>
    </div>
  );
}

// ── Metric Cell ──────────────────────────────────────────────────────────────

function MetricCell({ value, label }: { value: string; label: string }) {
  return (
    <dl className="flex flex-col items-center">
      <dd className="text-lg font-semibold tabular-nums leading-tight m-0">{value}</dd>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
    </dl>
  );
}

// ── Bar User View ────────────────────────────────────────────────────────────

function BarUserView({ diskSpace }: { diskSpace: DiskSpaceInfo | null }) {
  const t = useTranslations("dashboard.systemStatus");
  const { fileCount, activeShareCount } = useDashboardMetrics();

  const hasQuota = diskSpace && diskSpace.diskAvailableGB !== -1 && diskSpace.diskSizeGB > 0;
  const hasMetrics = fileCount !== undefined || activeShareCount !== undefined;

  if (!hasQuota && !hasMetrics) return null;

  return (
    <div className="flex flex-col sm:flex-row items-stretch gap-4">
      {/* Storage Quota */}
      {hasQuota && diskSpace && (
        <CompactProgressBar
          label={t("quota.label")}
          percentage={diskSpace.percentage ?? 0}
          used={formatStorageSize(diskSpace.diskUsedGB)}
          total={formatStorageSize(diskSpace.diskSizeGB)}
          ariaLabel={t("quota.ariaLabel")}
          warningLevel={diskSpace.warningLevel}
        />
      )}

      {/* Unlimited quota — just show used */}
      {diskSpace && !hasQuota && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("quota.label")}:</span>
          <span className="tabular-nums">{formatStorageSize(diskSpace.diskUsedGB)}</span>
          <span>({t("quota.unlimited")})</span>
        </div>
      )}

      {/* Vertical divider (desktop) / horizontal separator (mobile) */}
      {hasQuota && hasMetrics && <div className="hidden sm:block w-px bg-border/60 self-stretch" />}
      {hasQuota && hasMetrics && <div className="sm:hidden h-px bg-border/60 w-full" />}

      {/* Personal metrics */}
      {hasMetrics && (
        <div className="flex items-center gap-6">
          {fileCount !== undefined && (
            <MetricCell value={String(fileCount)} label={t("metrics.myFiles")} />
          )}
          {activeShareCount !== undefined && (
            <MetricCell value={String(activeShareCount)} label={t("metrics.activeShares")} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Bar Admin View ───────────────────────────────────────────────────────────

function BarAdminView({
  healthData,
  diskSpace,
  adminStats,
  adminStatsError,
  diskSpaceError,
}: {
  healthData: CheckHealth200 | null;
  diskSpace: DiskSpaceInfo | null;
  adminStats: AdminStats200 | null;
  adminStatsError: string | null;
  diskSpaceError: string | null;
}) {
  const t = useTranslations("dashboard.systemStatus");

  const dbOk = healthData?.checks.database === "ok";
  const storageStatus = healthData?.checks.storage;

  const storageDisplay = storageStatus
    ? (() => {
        switch (storageStatus) {
          case "ok":
            return {
              icon: <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />,
              label: t("checks.ok"),
            };
          case "not_configured":
            return {
              icon: <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" />,
              label: t("checks.notConfigured"),
            };
          case "error":
            return {
              icon: <XCircle className="size-3 text-red-600 dark:text-red-400" />,
              label: t("checks.error"),
            };
        }
      })()
    : null;

  // Disk space calculation
  const diskUsagePercent = diskSpace
    ? Math.round((diskSpace.diskUsedGB / (diskSpace.diskSizeGB || 1)) * 100)
    : 0;

  return (
    <div className="flex flex-col sm:flex-row items-stretch gap-4">
      {/* Health checks */}
      {healthData && (
        <div className="flex items-center gap-4 text-xs">
          {/* Database */}
          <div className="flex items-center gap-1">
            {dbOk ? (
              <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="size-3 text-red-600 dark:text-red-400" />
            )}
            <span className="text-muted-foreground">{t("checks.database")}</span>
          </div>

          {/* Storage */}
          {storageDisplay && (
            <div className="flex items-center gap-1">
              {storageDisplay.icon}
              <span className="text-muted-foreground">{t("checks.storage")}</span>
            </div>
          )}

          {/* Uptime */}
          <div className="flex items-center gap-1 text-muted-foreground">
            <span>{t("uptime")}:</span>
            <span className="tabular-nums">{formatUptime(healthData.uptime)}</span>
          </div>
        </div>
      )}

      {/* Vertical divider */}
      {healthData && diskSpace && (
        <div className="hidden sm:block w-px bg-border/60 self-stretch" />
      )}
      {healthData && diskSpace && <div className="sm:hidden h-px bg-border/60 w-full" />}

      {/* Disk space */}
      {diskSpaceError ? (
        <p className="text-xs text-destructive">{t("errors.diskSpaceError")}</p>
      ) : diskSpace ? (
        <CompactProgressBar
          label={t("diskSpace.label")}
          percentage={diskUsagePercent}
          used={formatStorageSize(diskSpace.diskUsedGB)}
          total={formatStorageSize(diskSpace.diskSizeGB)}
          ariaLabel={t("diskSpace.ariaLabel")}
        />
      ) : null}

      {/* Vertical divider */}
      {diskSpace && adminStats && (
        <div className="hidden sm:block w-px bg-border/60 self-stretch" />
      )}
      {diskSpace && adminStats && <div className="sm:hidden h-px bg-border/60 w-full" />}

      {/* Platform metrics */}
      {adminStatsError ? (
        <p className="text-xs text-destructive">{t("errors.statsError")}</p>
      ) : adminStats ? (
        <div className="flex items-center gap-4">
          <MetricCell
            value={`${adminStats.users.active}/${adminStats.users.total}`}
            label={t("metrics.users")}
          />
          <MetricCell value={String(adminStats.files.total)} label={t("metrics.files")} />
          <MetricCell value={String(adminStats.shares.active)} label={t("metrics.shares")} />
        </div>
      ) : null}
    </div>
  );
}

// ── Expanded Panel ───────────────────────────────────────────────────────────

function ExpandedPanel({
  status,
  isLoading,
  isAdmin,
  hasError,
  errorMessage,
  onToggle,
  onRefresh,
  isRefreshing,
  children,
}: {
  status: OverallStatus;
  isLoading: boolean;
  isAdmin: boolean;
  hasError: boolean;
  errorMessage?: string;
  onToggle: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("dashboard.systemStatus");
  const colors = STATUS_COLORS[status];
  const pulseClass = PULSE_CLASSES[status] ?? "";

  const statusLabelMap: Record<OverallStatus, string> = {
    healthy: t("status.healthy"),
    degraded: t("status.degraded"),
    unhealthy: t("status.unhealthy"),
  };

  return (
    <section id="system-status-panel" className={`${GLASS_PANEL} w-full`} aria-label={t("title")}>
      <div className="max-w-7xl mx-auto px-6 py-3">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${colors.dot} ${colors.glow} ${pulseClass}`}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold">{t("title")}</span>
            {!isLoading && !hasError && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  status === "healthy"
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : status === "degraded"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {statusLabelMap[status]}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md hover:bg-background/50 transition-colors disabled:opacity-50"
            aria-label={t("refresh")}
          >
            <RefreshCw
              className={`size-3.5 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex gap-4">
            <div className="h-8 flex-1 bg-muted/50 rounded animate-pulse" />
            <div className="h-8 flex-1 bg-muted/50 rounded animate-pulse" />
            {isAdmin && <div className="h-8 flex-1 bg-muted/50 rounded animate-pulse" />}
          </div>
        ) : hasError ? (
          <ErrorDisplay
            variant="inline"
            title={t("errors.title")}
            message={errorMessage ?? t("errors.fetchFailed")}
            actions={[{ label: t("refresh"), onClick: onRefresh, variant: "outline" }]}
          />
        ) : (
          children
        )}

        {/* Centered collapse button at bottom */}
        <div className="flex justify-center mt-2">
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded-md hover:bg-background/50 transition-colors"
            aria-label={t("collapse")}
            aria-expanded={true}
            aria-controls="system-status-panel"
          >
            <ChevronUp className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function SystemStatusBar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = useSystemStatus({ isExpanded });

  const toggle = () => setIsExpanded((prev) => !prev);

  // Derive overall status
  let overallStatus: OverallStatus = "healthy";
  const isLoading = status.isAdmin
    ? status.healthLoading || status.diskSpaceLoading || status.adminStatsLoading
    : status.healthStatusLoading;

  const hasError = status.isAdmin ? status.healthError : !!status.healthStatusError;

  if (!isLoading && !hasError) {
    if (status.isAdmin && status.healthData) {
      overallStatus = status.healthData.status;
    } else if (!status.isAdmin && status.healthStatus) {
      overallStatus = status.healthStatus.status;
    }
  }

  return (
    <div className="sticky top-16 z-30">
      {/* Expandable panel — CSS grid height animation */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
        aria-hidden={!isExpanded}
      >
        <div className="overflow-hidden min-h-0">
          <ExpandedPanel
            status={overallStatus}
            isLoading={isLoading}
            isAdmin={status.isAdmin}
            hasError={hasError}
            onToggle={toggle}
            onRefresh={status.refresh}
            isRefreshing={status.isRefreshing}
          >
            {status.isAdmin ? (
              <BarAdminView
                healthData={status.healthData}
                diskSpace={status.diskSpace}
                adminStats={status.adminStats}
                adminStatsError={status.adminStatsError}
                diskSpaceError={status.diskSpaceError}
              />
            ) : (
              <BarUserView diskSpace={status.diskSpace} />
            )}
          </ExpandedPanel>
        </div>
      </div>

      {/* Collapsed tab — visible when panel is collapsed */}
      {!isExpanded && (
        <CollapsedTab
          status={overallStatus}
          isLoading={isLoading}
          quotaPercentage={status.diskSpace?.percentage}
          warningLevel={status.diskSpace?.warningLevel}
          onToggle={toggle}
        />
      )}
    </div>
  );
}
