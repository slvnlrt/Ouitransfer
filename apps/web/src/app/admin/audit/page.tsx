"use client";

import { ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { PageLayout } from "@/components/layout/page-layout";

import { AuditLogExport } from "./components/audit-log-export";
import { AuditLogFilters } from "./components/audit-log-filters";
import { AuditLogTable } from "./components/audit-log-table";
import { useAuditLogs } from "./hooks/use-audit-logs";

export default function AuditPage() {
  const t = useTranslations("audit");
  const {
    logs,
    total,
    isLoading,
    params,
    currentPage,
    totalPages,
    setPage,
    setFilters,
    clearFilters,
  } = useAuditLogs();

  return (
    <ProtectedRoute requireAdmin>
      <PageLayout>
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <ScrollText className="h-6 w-6" />
                {t("pageTitle")}
              </h1>
              <p className="text-muted-foreground mt-1">{t("pageDescription")}</p>
            </div>
            <AuditLogExport params={params} />
          </div>

          <AuditLogFilters params={params} onFilterChange={setFilters} onClear={clearFilters} />

          <AuditLogTable
            logs={logs}
            total={total}
            isLoading={isLoading}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
