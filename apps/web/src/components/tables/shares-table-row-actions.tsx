import {
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconEye,
  IconFolder,
  IconLink,
  IconMail,
  IconQrcode,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Share } from "@/http/endpoints/shares/types";

interface ShareRowActionsProps {
  share: Share;
  smtpEnabled: string | null;
  onDelete: (share: Share) => void;
  onEdit: (share: Share) => void;
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
  smtpEnabled,
  onDelete,
  onEdit,
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted cursor-pointer">
          <IconDotsVertical className="h-4 w-4" />
          <span className="sr-only">{t("sharesTable.actions.menu")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onEdit(share)}>
          <IconEdit className="h-4 w-4" />
          {t("sharesTable.actions.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onManageFiles(share)}>
          <IconFolder className="h-4 w-4" />
          {t("sharesTable.actions.manageFiles")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onManageRecipients(share)}>
          <IconUsers className="h-4 w-4" />
          {t("sharesTable.actions.manageRecipients")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onViewDetails(share)}>
          <IconEye className="h-4 w-4" />
          {t("sharesTable.actions.viewDetails")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onGenerateLink(share)}>
          <IconLink className="h-4 w-4" />
          {share.alias ? t("sharesTable.actions.editLink") : t("sharesTable.actions.generateLink")}
        </DropdownMenuItem>
        {share.alias && (
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onCopyLink(share)}>
            <IconCopy className="h-4 w-4" />
            {t("sharesTable.actions.copyLink")}
          </DropdownMenuItem>
        )}
        {share.alias && onViewQrCode && (
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onViewQrCode(share)}>
            <IconQrcode className="h-4 w-4" />
            {t("sharesTable.actions.viewQrCode", { defaultValue: "View QR Code" })}
          </DropdownMenuItem>
        )}
        {share.recipients?.length > 0 && share.alias && smtpEnabled === "true" && (
          <DropdownMenuItem className="cursor-pointer py-2" onClick={() => onNotifyRecipients(share)}>
            <IconMail className="h-4 w-4" />
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
            <IconDownload className="h-4 w-4" />
            {t("sharesTable.actions.downloadShareFiles")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onDelete(share)}
          className="cursor-pointer py-2 text-destructive focus:text-destructive"
        >
          <IconTrash className="h-4 w-4" />
          {t("sharesTable.actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
