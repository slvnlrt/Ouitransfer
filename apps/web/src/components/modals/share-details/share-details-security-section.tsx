"use client";

import { Bell, Clock, Lock, LockOpen, Pencil, UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Share } from "@/http/endpoints/shares/types";

interface ShareDetailsSecuritySectionProps {
  share: Share;
  onEditSecurity?: () => void;
}

/** Returns true when at least one privacy field is set to a non-default value. */
function hasPrivacySettings(share: Share): boolean {
  return (
    share.nameFieldRequired !== "HIDDEN" ||
    share.emailFieldRequired !== "HIDDEN" ||
    share.notifyOnDownload ||
    (share.inactivityAlertDays !== null && share.inactivityAlertDays > 0)
  );
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

      {/* Read-only privacy summary — only shown when at least one setting is non-default */}
      {hasPrivacySettings(share) && (
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("shareDetails.privacySummary")}
          </p>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {share.nameFieldRequired !== "HIDDEN" && (
              <span className="flex items-center gap-1.5">
                <UserCircle className="h-3 w-3 flex-shrink-0" />
                {t("shareDetails.privacyNameField")}{" "}
                {t(`shareDetails.fieldValue.${share.nameFieldRequired}`)}
              </span>
            )}
            {share.emailFieldRequired !== "HIDDEN" && (
              <span className="flex items-center gap-1.5">
                <UserCircle className="h-3 w-3 flex-shrink-0" />
                {t("shareDetails.privacyEmailField")}{" "}
                {t(`shareDetails.fieldValue.${share.emailFieldRequired}`)}
              </span>
            )}
            {share.notifyOnDownload && (
              <span className="flex items-center gap-1.5">
                <Bell className="h-3 w-3 flex-shrink-0" />
                {t("shareDetails.privacyNotifyOnDownload")}
              </span>
            )}
            {share.inactivityAlertDays !== null && share.inactivityAlertDays > 0 && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 flex-shrink-0" />
                {t("shareDetails.privacyInactivityAlert", { days: share.inactivityAlertDays })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
