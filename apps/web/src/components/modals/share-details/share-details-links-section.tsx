"use client";

import { Copy, ExternalLink, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

interface ShareDetailsLinksSectionProps {
  shareLink: string | null;
  onEditLink?: () => void;
}

export function ShareDetailsLinksSection({ shareLink, onEditLink }: ShareDetailsLinksSectionProps) {
  const t = useTranslations();
  const { copy } = useCopyToClipboard();

  const handleCopyLink = async () => {
    if (shareLink) {
      const ok = await copy(shareLink);
      if (ok) {
        toast.success(t("shareDetails.linkCopied"));
      }
    }
  };

  const handleOpenLink = () => {
    if (shareLink) {
      window.open(shareLink, "_blank");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.shareLink")}</h3>
        {onEditLink && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={onEditLink}
            title={shareLink ? t("shareDetails.editLink") : t("shareDetails.generateLink")}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {shareLink ? (
        <div className="flex gap-2">
          <Input value={shareLink} readOnly className="flex-1 bg-muted/30 text-sm h-8" />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopyLink}
            title={t("shareDetails.copyLink")}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleOpenLink}
            title={t("shareDetails.openLink")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between p-2 bg-muted/20 rounded-lg">
          <p className="text-sm text-muted-foreground">{t("shareDetails.noLink")}</p>
        </div>
      )}
    </div>
  );
}
