"use client";

import { ChevronLeft, ChevronRight, Clock, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRelativeTime } from "@/utils/format-relative-time";
import type { LdapSyncOperationsProps } from "../types";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  success: "default",
  partial: "secondary",
  error: "destructive",
  running: "secondary",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function LdapSyncOperations({
  status,
  logs,
  totalLogs,
  isLoading,
  isSyncing,
  onSync,
  onViewDetail,
  page,
  onPageChange,
}: LdapSyncOperationsProps) {
  const t = useTranslations();
  const pageSize = 10;
  const totalPages = Math.ceil(totalLogs / pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{t("ldap.sync.title")}</CardTitle>
              <CardDescription>{t("ldap.sync.description")}</CardDescription>
            </div>
          </div>
          <Button onClick={onSync} disabled={isSyncing || (status?.syncInProgress ?? false)}>
            {(isSyncing || status?.syncInProgress) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("ldap.sync.syncNow")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Summary */}
        {status && (
          <div className="flex items-center gap-4 text-sm">
            {status.lastSync && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("ldap.sync.lastSync")}:</span>
                <span>{formatRelativeTime(status.lastSync.startedAt, t)}</span>
                <Badge variant={STATUS_VARIANTS[status.lastSync.status] ?? "secondary"}>
                  {status.lastSync.status}
                </Badge>
              </div>
            )}
            {status.nextSyncAt && (
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{t("ldap.sync.nextSync")}:</span>
                <span>{formatDate(status.nextSyncAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* History Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("ldap.sync.noHistory")}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ldap.sync.date")}</TableHead>
                  <TableHead>{t("ldap.sync.trigger")}</TableHead>
                  <TableHead>{t("ldap.sync.duration")}</TableHead>
                  <TableHead>{t("ldap.sync.created")}</TableHead>
                  <TableHead>{t("ldap.sync.updated")}</TableHead>
                  <TableHead>{t("ldap.sync.deactivated")}</TableHead>
                  <TableHead>{t("ldap.sync.reactivated")}</TableHead>
                  <TableHead>{t("ldap.sync.skipped")}</TableHead>
                  <TableHead>{t("ldap.sync.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onViewDetail(log)}
                  >
                    <TableCell className="text-xs">{formatDate(log.startedAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.trigger}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDuration(log.startedAt, log.completedAt)}
                    </TableCell>
                    <TableCell>{log.usersCreated}</TableCell>
                    <TableCell>{log.usersUpdated}</TableCell>
                    <TableCell>{log.usersDeactivated}</TableCell>
                    <TableCell>{log.usersReactivated}</TableCell>
                    <TableCell>{log.usersSkipped}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[log.status] ?? "secondary"}>
                        {log.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
