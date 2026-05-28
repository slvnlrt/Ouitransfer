"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { getShareVisits } from "@/http/endpoints";
import type { ShareVisit } from "@/http/endpoints/shares/types";
import { queryKeys } from "@/lib/query-keys";

interface ShareDetailsActivitySectionProps {
  shareId: string;
}

const PAGE_LIMIT = 10;

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function truncateIp(ip: string | null): string {
  if (!ip) return "";
  // Show only the first two octets for IPv4, or first two groups for IPv6
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  const v6parts = ip.split(":");
  if (v6parts.length > 2) {
    return `${v6parts[0]}:${v6parts[1]}:…`;
  }
  return ip;
}

interface VisitEntryProps {
  visit: ShareVisit;
}

function VisitEntry({ visit }: VisitEntryProps) {
  const t = useTranslations();
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
        {formatRelativeTime(visit.createdAt)}
      </span>
    </div>
  );
}

export function ShareDetailsActivitySection({ shareId }: ShareDetailsActivitySectionProps) {
  const t = useTranslations();
  const [page, setPage] = useState(1);

  const visitsQuery = useQuery({
    queryKey: queryKeys.shares.visits(shareId, { page, limit: PAGE_LIMIT }),
    queryFn: async () => {
      const response = await getShareVisits(shareId, { page, limit: PAGE_LIMIT });
      return response.data;
    },
    enabled: !!shareId,
  });

  const visits = visitsQuery.data?.visits ?? [];
  const total = visitsQuery.data?.total ?? 0;
  const hasMore = visits.length > 0 && page * PAGE_LIMIT < total;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium text-foreground border-b pb-2">
        {t("shareDetails.activity.title")}
      </h3>

      {visitsQuery.isLoading ? (
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
