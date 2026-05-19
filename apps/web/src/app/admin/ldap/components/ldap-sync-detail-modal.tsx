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
import type { LdapSyncDetailModalProps } from "../types";

interface SyncDetailEntry {
  type: "skip" | "error";
  username: string;
  email?: string;
  message: string;
}

export function LdapSyncDetailModal({ log, isOpen, onClose }: LdapSyncDetailModalProps) {
  const t = useTranslations();

  if (!log) return null;

  let details: SyncDetailEntry[] = [];
  try {
    details = log.details ? (JSON.parse(log.details) as SyncDetailEntry[]) : [];
  } catch {
    details = [];
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ldap.syncDetail.title")}</DialogTitle>
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
              {log.status}
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
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant={detail.type === "error" ? "destructive" : "secondary"}>
                        {detail.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{detail.username || "—"}</TableCell>
                    <TableCell className="text-xs">{detail.email ?? "—"}</TableCell>
                    <TableCell className="text-xs">{detail.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
