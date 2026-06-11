"use client";

import { Copy, Download, Link } from "lucide-react";
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
import { ALIAS_MAX_LENGTH, ALIAS_MIN_LENGTH, getAliasValidationError } from "@/utils/alias";
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

  const aliasErrorKey = getAliasValidationError(alias);
  const aliasError = aliasErrorKey
    ? t(`common.aliasValidation.${aliasErrorKey}`, {
        min: ALIAS_MIN_LENGTH,
        max: ALIAS_MAX_LENGTH,
      })
    : null;

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
          <DialogTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
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
              aria-invalid={aliasError !== null}
            />
            {aliasError && <p className="text-sm text-destructive">{aliasError}</p>}
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground text-start">
              {t("generateShareLink.readyDescription")}
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
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onClose()} disabled={isLoading}>
              {isEdit ? t("common.cancel") : t("generateShareLink.later")}
            </Button>
            <Button disabled={!alias || isLoading || aliasError !== null} onClick={handleGenerate}>
              {isEdit ? t("generateShareLink.updateButton") : t("generateShareLink.generateButton")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
