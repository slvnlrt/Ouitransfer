"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Eye } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getShareVisits } from "@/http/endpoints";
import type { ShareVisit } from "@/http/endpoints/shares/types";
import { queryKeys } from "@/lib/query-keys";

interface ShareDetailsActivitySectionProps {
  shareId: string;
}

const PAGE_LIMIT = 10;

// Privacy note: IPv4 addresses are truncated to the first two octets (e.g. 192.168.*.*),
// which corresponds roughly to city-level geolocation. This balances the share owner's
// need to see approximate visitor origin against visitor privacy. IPv6 addresses are
// similarly truncated to the first three groups.
function truncateIp(ip: string | null): string {
  if (!ip) return "";

  // IPv6: any address containing ":"
  if (ip.includes(":")) {
    const groups = ip.split(":");
    // Find empty segment (from ::) — e.g. "2001:db8::1" splits to ["2001","db8","","1"]
    const emptyIdx = groups.indexOf("");

    if (emptyIdx >= 0 && emptyIdx <= 3) {
      // Compressed form — take available prefix groups before the empty segment (up to 3)
      const prefix = groups.slice(0, Math.min(emptyIdx || 1, 3)).filter(Boolean);
      return prefix.length > 0 ? `${prefix.join(":")}::…` : "::…";
    }

    // Full or partially compressed — take first 3 groups
    return `${groups.slice(0, 3).join(":")}::…`;
  }

  // IPv4: show first two octets
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`;
  }

  return ip;
}

interface VisitEntryProps {
  visit: ShareVisit;
}

function VisitEntry({ visit }: VisitEntryProps) {
  const t = useTranslations();
  const format = useFormatter();
  const isDownload = visit.action === "download";
  const hasIdentity = !!(visit.visitorName || visit.visitorEmail);

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 flex-shrink-0 rounded-full bg-muted p-1.5">
        {isDownload ? (
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {isDownload ? t("shareDetails.activity.download") : t("shareDetails.activity.access")}
        </p>
        {hasIdentity ? (
          <p className="text-xs text-muted-foreground truncate">
            {visit.visitorName}
            {visit.visitorName && visit.visitorEmail && " · "}
            {visit.visitorEmail}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("shareDetails.activity.anonymous")}
            {visit.ipAddress && ` · ${truncateIp(visit.ipAddress)}`}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground flex-shrink-0 mt-0.5">
        {format.relativeTime(new Date(visit.createdAt))}
      </span>
    </div>
  );
}

type ActionFilter = "all" | "access" | "download";
type IdentityFilter = "all" | "identified" | "anonymous";

export function ShareDetailsActivitySection({ shareId }: ShareDetailsActivitySectionProps) {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("all");

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [actionFilter, identityFilter]);

  const actionParam = actionFilter === "all" ? undefined : actionFilter;

  const visitsQuery = useQuery({
    queryKey: queryKeys.shares.visits(shareId, { page, limit: PAGE_LIMIT, action: actionParam }),
    queryFn: async () => {
      const response = await getShareVisits(shareId, {
        page,
        limit: PAGE_LIMIT,
        action: actionParam,
      });
      return response.data;
    },
    enabled: !!shareId,
    placeholderData: keepPreviousData,
  });

  // Client-side identification filter
  const rawVisits = visitsQuery.data?.visits ?? [];
  const visits =
    identityFilter === "all"
      ? rawVisits
      : rawVisits.filter((v) => {
          const hasIdentity = !!(v.visitorName || v.visitorEmail);
          return identityFilter === "identified" ? hasIdentity : !hasIdentity;
        });
  const total = visitsQuery.data?.total ?? 0;
  const hasMore = rawVisits.length > 0 && page * PAGE_LIMIT < total;

  // If we land on a page > 1 that returns no results (e.g. page deleted/expired),
  // auto-reset to page 1 instead of showing a misleading "no activity" message.
  useEffect(() => {
    if (visits.length === 0 && page > 1 && !visitsQuery.isLoading && !visitsQuery.isError) {
      setPage(1);
    }
  }, [visits.length, page, visitsQuery.isLoading, visitsQuery.isError]);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium text-foreground border-b pb-2">
        {t("shareDetails.activity.title")}
      </h3>

      <div className="flex flex-wrap gap-2">
        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("shareDetails.activity.filterAll")}</SelectItem>
            <SelectItem value="access">{t("shareDetails.activity.filterAccess")}</SelectItem>
            <SelectItem value="download">{t("shareDetails.activity.filterDownload")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={identityFilter}
          onValueChange={(v) => setIdentityFilter(v as IdentityFilter)}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("shareDetails.activity.filterAllVisitors")}</SelectItem>
            <SelectItem value="identified">
              {t("shareDetails.activity.filterIdentified")}
            </SelectItem>
            <SelectItem value="anonymous">{t("shareDetails.activity.filterAnonymous")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visitsQuery.isError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">{t("shareDetails.activity.loadError")}</p>
          <Button variant="outline" size="sm" onClick={() => visitsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : visitsQuery.isLoading ? (
        <div className="flex justify-center py-4">
          <Loader size="sm" />
        </div>
      ) : visits.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t("shareDetails.activity.noActivity")}
        </p>
      ) : (
        <div className="space-y-0 divide-y divide-border">
          {visits.map((visit) => (
            <VisitEntry key={visit.id} visit={visit} />
          ))}
        </div>
      )}

      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("shareDetails.activity.showingCount", { shown: visits.length, total })}
        </p>
      )}

      <div className="flex gap-2">
        {page > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={visitsQuery.isLoading}
          >
            ←
          </Button>
        )}
        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={visitsQuery.isLoading}
          >
            {t("shareDetails.activity.loadMore")}
          </Button>
        )}
      </div>
    </div>
  );
}
