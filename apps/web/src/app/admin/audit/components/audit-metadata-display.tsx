"use client";

import { useTranslations } from "next-intl";

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

  if (!metadata || Object.keys(metadata).length === 0) return null;

  // Special rendering for quota changes
  if (
    action === "USER_QUOTA_CHANGE" &&
    metadata.oldQuota !== undefined &&
    metadata.newQuota !== undefined
  ) {
    return (
      <span className="text-sm">
        {formatBytes(metadata.oldQuota as string | number)} →{" "}
        {formatBytes(metadata.newQuota as string | number)}
      </span>
    );
  }

  // Generic key-value rendering
  return (
    <div className="space-y-1 text-sm">
      {Object.entries(metadata).map(([key, value]) => {
        const label = safeTranslate(t, key);
        const displayValue = Array.isArray(value)
          ? value.join(", ")
          : typeof value === "boolean"
            ? value
              ? "Yes"
              : "No"
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
