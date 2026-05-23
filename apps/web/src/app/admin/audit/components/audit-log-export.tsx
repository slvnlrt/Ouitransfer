"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportAuditLogs } from "@/http/endpoints/audit";
import type { AuditLogsParams } from "@/http/endpoints/audit/types";

interface AuditLogExportProps {
  params: AuditLogsParams;
}

export function AuditLogExport({ params }: AuditLogExportProps) {
  const t = useTranslations("audit");

  const hasDateRange = Boolean(params.dateFrom && params.dateTo);

  const handleExport = (format: "csv" | "json") => {
    if (!params.dateFrom || !params.dateTo) return;

    const url = exportAuditLogs({
      format,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      search: params.search,
    });
    window.open(url, "_blank");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!hasDateRange}>
          <Download className="h-4 w-4" />
          {t("export.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!hasDateRange ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("export.dateRangeRequired")}
          </div>
        ) : (
          <>
            <DropdownMenuItem onClick={() => handleExport("csv")}>
              {t("export.csv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("json")}>
              {t("export.json")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
