"use client";

import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { PageLayout } from "@/components/layout/page-layout";
import { listUsers } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";

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

  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: async ({ signal }) => {
      const response = await listUsers({ signal });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of usersQuery.data ?? []) {
      const firstName = user.firstName.trim();
      const lastName = user.lastName.trim();
      const displayName =
        firstName && lastName
          ? `${firstName} ${lastName}`
          : firstName || lastName || user.username || user.email;
      map.set(user.id, displayName);
    }
    return map;
  }, [usersQuery.data]);

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
            userMap={userMap}
          />
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
