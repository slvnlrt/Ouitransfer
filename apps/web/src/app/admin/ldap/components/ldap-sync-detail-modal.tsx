"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/utils/format-relative-time";
import type { LdapSyncDetailModalProps } from "../types";

interface SyncDetailEntry {
  type: "skip" | "error";
  username: string;
  email?: string;
  message: string;
}

export function LdapSyncDetailModal({ log, isOpen, onClose }: LdapSyncDetailModalProps) {
  const t = useTranslations();

  // M-7: Don't return null early — render Dialog always so exit animation works.
  // The log may be null briefly during close animation.

  let details: SyncDetailEntry[] = [];
  if (log?.details) {
    try {
      details = JSON.parse(log.details) as SyncDetailEntry[];
    } catch {
      details = [];
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle>{t("ldap.syncDetail.title")}</DialogTitle>
              {/* M-6: Show timestamps and duration */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  {t("ldap.sync.date")}: {new Date(log.startedAt).toLocaleString()}
                </span>
                {log.completedAt && (
                  <span>
                    {t("ldap.sync.duration")}: {formatDuration(log.startedAt, log.completedAt)}
                  </span>
                )}
              </div>
            </DialogHeader>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.created")}:</span>{" "}
                <strong>{log.usersCreated}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.updated")}:</span>{" "}
                <strong>{log.usersUpdated}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.deactivated")}:</span>{" "}
                <strong>{log.usersDeactivated}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.reactivated")}:</span>{" "}
                <strong>{log.usersReactivated}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.skipped")}:</span>{" "}
                <strong>{log.usersSkipped}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("ldap.sync.status")}:</span>{" "}
                <Badge
                  variant={
                    log.status === "success"
                      ? "default"
                      : log.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {t(`ldap.sync.statusLabel.${log.status}` as never)}
                </Badge>
              </div>
            </div>

            {/* Details */}
            {details.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t("ldap.syncDetail.details")}</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("ldap.syncDetail.type")}</TableHead>
                      <TableHead>{t("ldap.syncDetail.username")}</TableHead>
                      <TableHead>{t("ldap.syncDetail.email")}</TableHead>
                      <TableHead>{t("ldap.syncDetail.message")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.map((detail, i) => (
                      // M-4: Use composite key instead of index
                      <TableRow key={`${detail.type}-${detail.username}-${i}`}>
                        <TableCell>
                          <Badge variant={detail.type === "error" ? "destructive" : "secondary"}>
                            {t(`ldap.syncDetail.detailType.${detail.type}` as never)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {detail.username || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{detail.email ?? "—"}</TableCell>
                        <TableCell className="text-xs">{detail.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
