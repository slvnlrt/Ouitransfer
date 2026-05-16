import { Activity, CircleAlert, Database, HardDrive } from "lucide-react";
import { useTranslations } from "next-intl";

import { ErrorDisplay } from "@/components/error-display";
import { Card, CardContent } from "@/components/ui/card";
import type { SystemHealthProps } from "../types";

/**
 * Formats a raw uptime value (seconds) into a human-readable string.
 * Examples: "2d 5h 30m", "45m", "12h 3m"
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  // Always show minutes, even if 0, unless days or hours cover it
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

export function SystemHealth({ healthData, healthError }: SystemHealthProps) {
  const t = useTranslations();

  // ── Error state ────────────────────────────────────────────────────
  if (healthError) {
    return (
      <Card className="w-full">
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Activity className="text-muted-foreground size-6" />
                {t("systemHealth.title")}
              </h2>
            </div>
            <ErrorDisplay
              variant="inline"
              title={t("systemHealth.errors.title")}
              message={t("systemHealth.errors.fetchFailed")}
              icon={<CircleAlert className="h-8 w-8 text-amber-600 dark:text-amber-400" />}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Loading skeleton ───────────────────────────────────────────────
  if (!healthData) {
    return (
      <Card className="w-full">
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Activity className="text-muted-foreground size-6" />
                {t("systemHealth.title")}
              </h2>
              <div className="h-4 w-20 bg-muted rounded animate-pulse" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Derive visual states ───────────────────────────────────────────
  const isHealthy = healthData.status === "healthy";
  const dbOk = healthData.checks.database === "ok";
  const storageOk =
    healthData.checks.storage === "ok" || healthData.checks.storage === "not_configured";

  // Amber if one check fails, red if all checks fail
  const statusColor = isHealthy
    ? "text-green-600 dark:text-green-400"
    : dbOk || storageOk
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  const statusDotColor = isHealthy
    ? "bg-green-500"
    : dbOk || storageOk
      ? "bg-amber-500"
      : "bg-red-500";

  const statusLabel = isHealthy
    ? t("systemHealth.status.healthy")
    : t("systemHealth.status.degraded");

  const storageLabel =
    healthData.checks.storage === "ok"
      ? t("systemHealth.checks.ok")
      : healthData.checks.storage === "not_configured"
        ? t("systemHealth.checks.notConfigured")
        : t("systemHealth.checks.error");

  // ── Normal state ───────────────────────────────────────────────────
  return (
    <Card className="w-full">
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="text-muted-foreground size-6" />
              {t("systemHealth.title")}
            </h2>
            <span className={`flex items-center gap-1.5 text-sm font-medium ${statusColor}`}>
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDotColor}`}
                aria-hidden="true"
              />
              {statusLabel}
            </span>
          </div>

          {/* Check rows */}
          <div className="flex flex-col gap-2 text-sm">
            {/* Database */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Database className="size-4" aria-hidden="true" />
                {t("systemHealth.checks.database")}
              </span>
              <span
                className={
                  dbOk ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                }
              >
                {dbOk ? t("systemHealth.checks.ok") : t("systemHealth.checks.error")}
              </span>
            </div>

            {/* Storage */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground">
                <HardDrive className="size-4" aria-hidden="true" />
                {t("systemHealth.checks.storage")}
              </span>
              <span
                className={
                  healthData.checks.storage === "error"
                    ? "text-red-600 dark:text-red-400"
                    : healthData.checks.storage === "not_configured"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-green-600 dark:text-green-400"
                }
              >
                {storageLabel}
              </span>
            </div>

            {/* Uptime */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("systemHealth.uptime")}</span>
              <span className="tabular-nums">{formatUptime(healthData.uptime)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
