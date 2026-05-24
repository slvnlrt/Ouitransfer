"use client";

import { useLocale, useTranslations } from "next-intl";

interface AuditMetadataDisplayProps {
  action: string;
  metadata: Record<string, unknown> | null;
}

function formatBytes(bytes: string | number): string {
  const b = typeof bytes === "string" ? Number.parseInt(bytes, 10) : bytes;
  if (Number.isNaN(b)) return String(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = b;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function safeTranslate(t: ReturnType<typeof useTranslations>, key: string): string {
  try {
    return t(key as never);
  } catch {
    return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
  }
}

export function AuditMetadataDisplay({ action, metadata }: AuditMetadataDisplayProps) {
  const t = useTranslations("audit.metadata");
  const locale = useLocale();

  if (!metadata || Object.keys(metadata).length === 0) return null;

  // Special rendering for quota changes — server emits oldMaxFileSize/newMaxFileSize/oldMaxTotalStorage/newMaxTotalStorage
  if (action === "USER_QUOTA_CHANGE") {
    const hasByteFields =
      metadata.oldMaxFileSize !== undefined ||
      metadata.newMaxFileSize !== undefined ||
      metadata.oldMaxTotalStorage !== undefined ||
      metadata.newMaxTotalStorage !== undefined;

    if (hasByteFields) {
      return (
        <div className="space-y-1 text-sm">
          {metadata.oldMaxFileSize !== undefined && metadata.newMaxFileSize !== undefined && (
            <div>
              {safeTranslate(t, "maxFileSize")}:{" "}
              {formatBytes(metadata.oldMaxFileSize as string | number)} →{" "}
              {formatBytes(metadata.newMaxFileSize as string | number)}
            </div>
          )}
          {metadata.oldMaxTotalStorage !== undefined &&
            metadata.newMaxTotalStorage !== undefined && (
              <div>
                {safeTranslate(t, "maxTotalStorage")}:{" "}
                {formatBytes(metadata.oldMaxTotalStorage as string | number)} →{" "}
                {formatBytes(metadata.newMaxTotalStorage as string | number)}
              </div>
            )}
        </div>
      );
    }
  }

  // Generic key-value rendering
  return (
    <div className="space-y-1 text-sm">
      {Object.entries(metadata).map(([key, value]) => {
        const label = safeTranslate(t, key);
        const displayValue = Array.isArray(value)
          ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
              value.map(String),
            )
          : typeof value === "boolean"
            ? value
              ? t("yes" as never)
              : t("no" as never)
            : String(value ?? "—");

        return (
          <div key={key} className="flex gap-2">
            <span className="text-muted-foreground font-medium">{label}:</span>
            <span className="break-all">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}
