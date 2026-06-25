import {
  CalendarClock,
  Copy,
  Download,
  EllipsisVertical,
  Eye,
  Folder,
  Link,
  Mail,
  Pause,
  Pencil,
  Play,
  QrCode,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Share } from "@/http/endpoints/shares/types";
import type { ShareLifecycleState } from "@/lib/share-lifecycle";

interface ShareRowActionsProps {
  share: Share;
  lifecycle: ShareLifecycleState;
  smtpEnabled: string | null;
  onDelete: (share: Share) => void;
  onEdit: (share: Share) => void;
  onPauseShare?: (share: Share) => void;
  onResumeShare?: (share: Share) => void;
  onRenewShare?: (share: Share) => void;
  onManageFiles: (share: Share) => void;
  onManageRecipients: (share: Share) => void;
  onViewDetails: (share: Share) => void;
  onGenerateLink: (share: Share) => void;
  onCopyLink: (share: Share) => void;
  onNotifyRecipients: (share: Share) => void;
  onViewQrCode?: (share: Share) => void;
  onDownloadShareFiles?: (share: Share) => void;
}

export function ShareRowActions({
  share,
  lifecycle,
  smtpEnabled,
  onDelete,
  onEdit,
  onPauseShare,
  onResumeShare,
  onRenewShare,
  onManageFiles,
  onManageRecipients,
  onViewDetails,
  onGenerateLink,
  onCopyLink,
  onNotifyRecipients,
  onViewQrCode,
  onDownloadShareFiles,
}: ShareRowActionsProps) {
  const t = useTranslations();

  // Lifecycle affordances (Phase A.1):
  // - active            → Pause
  // - deactivated/manual → Resume (re-activates instantly)
  // - deactivated/expired|max_views → Renew (extend expiration / raise maxViews;
  //   a plain resume would be refused by the server)
  const showPause = lifecycle.kind === "active" && !!onPauseShare;
  const showResume =
    lifecycle.kind === "deactivated" && lifecycle.reason === "manual" && !!onResumeShare;
  const showRenew =
    lifecycle.kind === "deactivated" &&
    (lifecycle.reason === "expired" || lifecycle.reason === "max_views") &&
    !!onRenewShare;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted cursor-pointer">
          <EllipsisVertical className="h-4 w-4" />
          <span className="sr-only">{t("sharesTable.actions.menu")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {showPause && (
          <>
            <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onPauseShare?.(share)}>
              <Pause className="h-4 w-4" />
              {t("sharesTable.actions.pause")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {showResume && (
          <>
            <DropdownMenuItem
              className="cursor-pointer py-2"
              onClick={() => onResumeShare?.(share)}
            >
              <Play className="h-4 w-4" />
              {t("sharesTable.actions.resume")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {showRenew && (
          <>
            <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onRenewShare?.(share)}>
              <CalendarClock className="h-4 w-4" />
              {t("sharesTable.actions.renew")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onEdit(share)}>
          <Pencil className="h-4 w-4" />
          {t("sharesTable.actions.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onManageFiles(share)}>
          <Folder className="h-4 w-4" />
          {t("sharesTable.actions.manageFiles")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onManageRecipients(share)}>
          <Users className="h-4 w-4" />
          {t("sharesTable.actions.manageRecipients")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onViewDetails(share)}>
          <Eye className="h-4 w-4" />
          {t("sharesTable.actions.viewDetails")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onGenerateLink(share)}>
          <Link className="h-4 w-4" />
          {share.alias ? t("sharesTable.actions.editLink") : t("sharesTable.actions.generateLink")}
        </DropdownMenuItem>
        {share.alias && (
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onCopyLink(share)}>
            <Copy className="h-4 w-4" />
            {t("sharesTable.actions.copyLink")}
          </DropdownMenuItem>
        )}
        {share.alias && onViewQrCode && (
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onViewQrCode(share)}>
            <QrCode className="h-4 w-4" />
            {t("sharesTable.actions.viewQrCode", { defaultValue: "View QR Code" })}
          </DropdownMenuItem>
        )}
        {share.recipients?.length > 0 && share.alias && smtpEnabled === "true" && (
          <DropdownMenuItem
            className="cursor-pointer py-2"
            onClick={() => onNotifyRecipients(share)}
          >
            <Mail className="h-4 w-4" />
            {t("sharesTable.actions.notifyRecipients")}
          </DropdownMenuItem>
        )}
        {onDownloadShareFiles && share.files && share.files.length > 0 && (
          <DropdownMenuItem
            className="cursor-pointer py-2"
            onClick={() => {
              onDownloadShareFiles(share);
            }}
          >
            <Download className="h-4 w-4" />
            {t("sharesTable.actions.downloadShareFiles")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onDelete(share)}
          className="cursor-pointer py-2 text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("sharesTable.actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
