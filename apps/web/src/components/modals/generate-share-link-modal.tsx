"use client";

import { Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useQrDownload } from "@/hooks/use-qr-download";
import type { Share } from "@/http/endpoints/shares/types";
import { customNanoid } from "@/lib/utils";
import { generateQrFilename } from "@/utils/qr-download";

interface GenerateShareLinkModalProps {
  shareId: string | null;
  share: Share | null;
  onClose: () => void;
  onSuccess: () => void;
  onGenerate: (shareId: string, alias: string) => Promise<void>;
}

const generateCustomId = () =>
  customNanoid(10, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

export function GenerateShareLinkModal({
  shareId,
  share,
  onClose,
  onSuccess,
  onGenerate,
}: GenerateShareLinkModalProps) {
  const t = useTranslations();
  const { copy } = useCopyToClipboard();
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();
  const [alias, setAlias] = useState(() => generateCustomId());
  const [isLoading, setIsLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    if (shareId && share?.alias?.alias) {
      setIsEdit(true);
      setAlias(share.alias.alias);
    } else {
      setIsEdit(false);
      setAlias(generateCustomId());
    }
    setGeneratedLink("");
  }, [shareId, share]);

  const handleGenerate = async () => {
    if (!shareId) return;

    try {
      setIsLoading(true);
      await onGenerate(shareId, alias);
      const link = `${window.location.origin}/s/${alias}`;

      setGeneratedLink(link);
      onSuccess();
      toast.success(t("generateShareLink.success"));
    } catch {
      toast.error(t("generateShareLink.error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    const ok = await copy(generatedLink);
    if (ok) {
      toast.success(t("generateShareLink.copied"));
    }
  };

  return (
    <Dialog open={!!shareId} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("generateShareLink.updateTitle") : t("generateShareLink.generateTitle")}
          </DialogTitle>
        </DialogHeader>
        {!generatedLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isEdit
                ? t("generateShareLink.updateDescription")
                : t("generateShareLink.generateDescription")}
            </p>
            <Input
              placeholder={t("generateShareLink.aliasPlaceholder")}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground text-start">
              {t("generateShareLink.readyDescription", {
                defaultValue:
                  "Your share link is ready. You can scan the QR code directly, download it for later use, or copy the link below.",
              })}
            </p>
            <div className="flex flex-col items-center justify-center">
              <div ref={qrContainerRef} className="p-4 bg-card rounded-lg">
                <LazyQRCode
                  value={generatedLink}
                  size={200}
                  level="H"
                  fgColor="#000000"
                  bgColor="#FFFFFF"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex space-x-2">
                <Input readOnly value={generatedLink} className="flex-1" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                  title={t("generateShareLink.copyButton")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => downloadQr(qrContainerRef.current, generateQrFilename(share?.name))}
                disabled={isDownloading}
              >
                <Download className="h-4 w-4" />
                {t("qrCodeModal.download")}
              </Button>
            </DialogFooter>
          </div>
        )}
        {!generatedLink && (
          <DialogFooter>
            <Button disabled={!alias || isLoading} onClick={handleGenerate}>
              {isEdit ? t("generateShareLink.updateButton") : t("generateShareLink.generateButton")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
