"use client";

import { Check, Copy, Download, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useQrDownload } from "@/hooks/use-qr-download";
import { generateQrFilename } from "@/utils/qr-download";

import type { QuickShareSettings } from "../../hooks/use-quick-share";

interface QuickShareConfirmationProps {
  shareLink: string;
  settings: QuickShareSettings;
  fileCount: number;
  onReset: () => void;
}

export function QuickShareConfirmation({
  shareLink,
  settings,
  fileCount,
  onReset,
}: QuickShareConfirmationProps) {
  const t = useTranslations("quickShare.confirmation");
  const tExp = useTranslations("quickShare.upload.expiration");
  const { copy } = useCopyToClipboard();
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();

  const handleCopy = async () => {
    const ok = await copy(shareLink);
    if (ok) {
      toast.success(t("copied"));
    }
  };

  // Build summary line
  const summaryParts: string[] = [];
  summaryParts.push(t("summary.files", { count: fileCount }));
  if (settings.expiration !== "never") {
    summaryParts.push(t("summary.expires", { duration: tExp(settings.expiration) }));
  } else {
    summaryParts.push(t("summary.noExpiry"));
  }
  summaryParts.push(settings.isPasswordProtected ? t("summary.password") : t("summary.noPassword"));

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* Success icon */}
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <Check className="size-8 text-green-500" />
          </div>

          <h3 className="text-xl font-semibold text-foreground">{t("title")}</h3>

          {/* QR code */}
          <div ref={qrContainerRef} className="p-4 bg-card border rounded-lg">
            <LazyQRCode
              value={shareLink}
              size={180}
              level="H"
              fgColor="#000000"
              bgColor="#FFFFFF"
            />
          </div>

          {/* Link + copy */}
          <div className="flex w-full max-w-md gap-2">
            <Input readOnly value={shareLink} className="flex-1 text-center" />
            <Button variant="outline" size="icon" onClick={handleCopy} aria-label={t("copyLink")}>
              <Copy className="size-4" />
            </Button>
          </div>

          {/* Summary */}
          <p className="text-sm text-muted-foreground">{summaryParts.join(" · ")}</p>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() =>
                downloadQr(qrContainerRef.current, generateQrFilename(settings.name, "quickshare"))
              }
              disabled={isDownloading}
            >
              <Download className="size-4 mr-2" />
              {t("downloadQr")}
            </Button>
            <Button onClick={onReset}>
              <Plus className="size-4 mr-2" />
              {t("newShare")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
