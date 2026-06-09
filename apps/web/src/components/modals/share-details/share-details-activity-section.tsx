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

interface VisitEntryProps {
  visit: ShareVisit;
}

const SOURCE_LABEL_KEY = {
  tracking_token: "shareDetails.activity.source.tracking_token",
  cookie: "shareDetails.activity.source.cookie",
} as const;

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
          <p className="text-xs text-muted-foreground">{t("shareDetails.activity.anonymous")}</p>
        )}
        {visit.identificationSource !== "anonymous" &&
          visit.identificationSource in SOURCE_LABEL_KEY && (
            <span
              className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground"
              // Comfort-feature honesty (R-2): a "cookie" (self-declared) attribution is
              // unverified and spoofable. Surface a subtle hint so the owner doesn't read it
              // as a verified identity. The verified "tracking_token" source gets no caveat.
              title={
                visit.identificationSource === "cookie"
                  ? t("shareDetails.activity.source.selfDeclaredHint")
                  : undefined
              }
            >
              {t(SOURCE_LABEL_KEY[visit.identificationSource as keyof typeof SOURCE_LABEL_KEY])}
            </span>
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
  const identifiedParam =
    identityFilter === "identified"
      ? ("true" as const)
      : identityFilter === "anonymous"
        ? ("false" as const)
        : undefined;

  const visitsQuery = useQuery({
    queryKey: queryKeys.shares.visits(shareId, {
      page,
      limit: PAGE_LIMIT,
      action: actionParam,
      identified: identifiedParam,
    }),
    queryFn: async () => {
      const response = await getShareVisits(shareId, {
        page,
        limit: PAGE_LIMIT,
        action: actionParam,
        identified: identifiedParam,
      });
      return response.data;
    },
    enabled: !!shareId,
    placeholderData: keepPreviousData,
  });

  const visits = visitsQuery.data?.visits ?? [];
  const total = visitsQuery.data?.total ?? 0;
  const hasMore = visits.length > 0 && page * PAGE_LIMIT < total;

  // If we land on a page > 1 that returns no results (e.g. page deleted/expired),
  // auto-reset to page 1 instead of showing a misleading "no activity" message.
  // Only fires when the server genuinely returns an empty page — not during loading.
  useEffect(() => {
    if (visits.length === 0 && page > 1 && visitsQuery.isSuccess) {
      setPage(1);
    }
  }, [visits.length, page, visitsQuery.isSuccess]);

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
