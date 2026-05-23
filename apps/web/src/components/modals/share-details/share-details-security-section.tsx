"use client";

import { Lock, LockOpen, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Share } from "@/http/endpoints/shares/types";

interface ShareDetailsSecuritySectionProps {
  share: Share;
  onEditSecurity?: () => void;
}

export function ShareDetailsSecuritySection({
  share,
  onEditSecurity,
}: ShareDetailsSecuritySectionProps) {
  const t = useTranslations();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.security")}</h3>
        {onEditSecurity && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={onEditSecurity}
            title={t("shareDetails.editSecurity")}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {share.security?.hasPassword ? (
          <StatusBadge variant="warning" className="w-fit">
            <Lock className="h-3 w-3 me-1" />
            {t("shareDetails.passwordProtected")}
          </StatusBadge>
        ) : (
          <StatusBadge variant="success" className="w-fit">
            <LockOpen className="h-3 w-3 me-1" />
            {t("shareDetails.publicAccess")}
          </StatusBadge>
        )}
        {share.maxViews && (
          <StatusBadge variant="info" className="w-fit">
            {t("shareDetails.maxViews")} {share.maxViews}
          </StatusBadge>
        )}
      </div>
    </div>
  );
}
