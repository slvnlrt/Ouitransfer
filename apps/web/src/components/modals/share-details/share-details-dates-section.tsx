"use client";

import { Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { Share } from "@/http/endpoints/shares/types";
import { formatDateTime } from "@/lib/format-date-time";

interface ShareDetailsDatesSection {
  share: Share;
  onEditExpiration?: () => void;
}

export function ShareDetailsDatesSection({ share, onEditExpiration }: ShareDetailsDatesSection) {
  const t = useTranslations();
  const locale = useLocale();

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t("shareDetails.notAvailable");
    try {
      return formatDateTime(dateString, "table", locale);
    } catch {
      return t("shareDetails.invalidDate");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.dates")}</h3>
        {onEditExpiration && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={onEditExpiration}
            title={t("shareDetails.editExpiration")}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            {t("shareDetails.created")}
          </div>
          <div className="text-sm">{formatDate(share.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            {t("shareDetails.expires")}
          </div>
          <div className="text-sm">
            {share.expiration ? formatDate(share.expiration) : t("shareDetails.never")}
          </div>
        </div>
      </div>
    </div>
  );
}
