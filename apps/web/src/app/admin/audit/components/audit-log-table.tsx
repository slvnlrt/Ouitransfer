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
          <TableCell>
            <Skeleton className="h-4 w-28" />
          </TableCell>
          <TableCell>
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
            <TableHead>{t("table.ipAddress")}</TableHead>
            <TableHead className="w-10">{t("table.details")}</TableHead>
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
                    ) : log.action === "AUDIT_RETENTION_CLEANUP" ? (
                      <Badge variant="secondary">{t("table.system")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("table.anonymous")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {safeTranslate(t, `actions.${log.action}`, log.action)}
                    </Badge>
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
                  <TableCell className="font-mono text-xs">{log.ipAddress}</TableCell>
                  <TableCell>
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
            {total} {total === 1 ? "result" : "results"}
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
