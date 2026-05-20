type TranslatorFn = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Format a date string as a relative time ("just now", "5m ago", "2h ago", "3d ago").
 * Accepts a translator function for i18n support.
 */
export function formatRelativeTime(dateStr: string, t: TranslatorFn): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("ldap.time.justNow");
  if (minutes < 60) return t("ldap.time.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ldap.time.hoursAgo", { hours });
  return t("ldap.time.daysAgo", { days: Math.floor(hours / 24) });
}

/**
 * Format duration between two ISO date strings.
 */
export function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
