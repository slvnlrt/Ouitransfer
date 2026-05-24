"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditLogEntry } from "@/http/endpoints/audit/types";

import { AuditMetadataDisplay } from "./audit-metadata-display";

interface AuditLogTableProps {
  logs: AuditLogEntry[];
  total: number;
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// System actions that should display a "System" badge instead of a user
const SYSTEM_ACTIONS = new Set([
  "AUDIT_RETENTION_CLEANUP",
  "LDAP_SYNC_COMPLETED",
  "LDAP_SYNC_ERROR",
]);

function formatDate(dateString: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function safeTranslate(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    return t(key as never);
  } catch {
    return fallback;
  }
}

function getActionBadgeClasses(action: string): string {
  if (
    action.startsWith("LOGIN_") ||
    action.startsWith("LOGOUT") ||
    action.startsWith("PASSWORD_") ||
    action.startsWith("ACCOUNT_") ||
    action.startsWith("TRUSTED_") ||
    action.startsWith("AUTH_PROVIDER_")
  )
    return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
  if (action.startsWith("TWO_FACTOR_"))
    return "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300";
  if (action.startsWith("USER_"))
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300";
  if (action.startsWith("SHARE_"))
    return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
  if (action.startsWith("FILE_") || action.startsWith("FOLDER_"))
    return "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300";
  if (action.startsWith("REVERSE_SHARE_"))
    return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
  if (action.startsWith("GROUP_"))
    return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
  if (action.startsWith("LDAP_"))
    return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300";
  if (action.startsWith("INVITE_"))
    return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300";
  if (
    action.startsWith("ADMIN_") ||
    action.startsWith("LOGO_") ||
    action.startsWith("SMTP_") ||
    action.startsWith("BACKGROUND_")
  )
    return "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300";
  if (action.startsWith("AUDIT_"))
    return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
}

function LoadingSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={`skeleton-${i.toString()}`}>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell className="hidden md:table-cell">
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell className="hidden lg:table-cell">
            <Skeleton className="h-4 w-4" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function AuditLogTable({
  logs,
  total,
  isLoading,
  currentPage,
  totalPages,
  onPageChange,
}: AuditLogTableProps) {
  const t = useTranslations("audit");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const toggleRow = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("table.date")}</TableHead>
            <TableHead>{t("table.user")}</TableHead>
            <TableHead>{t("table.action")}</TableHead>
            <TableHead>{t("table.target")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("table.ipAddress")}</TableHead>
            <TableHead className="hidden lg:table-cell w-10">{t("table.details")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <LoadingSkeleton />
          ) : logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t("table.noResults")}
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => {
              const isExpanded = expandedRow === log.id;
              const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
              const isSystemAction = SYSTEM_ACTIONS.has(log.action);

              return (
                <TableRow
                  key={log.id}
                  className={hasMetadata ? "cursor-pointer" : ""}
                  onClick={() => hasMetadata && toggleRow(log.id)}
                >
                  <TableCell className="whitespace-nowrap">{formatDate(log.createdAt)}</TableCell>
                  <TableCell>
                    {log.userId ? (
                      <span className="font-mono text-xs">{log.userId.slice(0, 8)}…</span>
                    ) : isSystemAction ? (
                      <Badge variant="secondary">{t("table.system")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("table.anonymous")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-current/10 ${getActionBadgeClasses(log.action)}`}
                    >
                      {safeTranslate(t, `actions.${log.action}`, log.action)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {log.targetType ? (
                      <span className="text-sm">
                        <span className="text-muted-foreground">
                          {safeTranslate(t, `targetTypes.${log.targetType}`, log.targetType)}
                        </span>
                        {log.targetId && (
                          <span className="ml-1 font-mono text-xs">
                            {log.targetId.slice(0, 8)}…
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-xs">
                    {log.ipAddress}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {hasMetadata && (
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Expanded metadata rows — rendered outside the table for layout */}
      {!isLoading &&
        logs.map((log) => {
          if (expandedRow !== log.id) return null;
          return (
            <div key={`detail-${log.id}`} className="rounded-md border bg-muted/30 p-4">
              <AuditMetadataDisplay action={log.action} metadata={log.metadata} />
            </div>
          );
        })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("table.resultCount", { count: total } as never)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
