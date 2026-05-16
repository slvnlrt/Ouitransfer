"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { logger } from "@/lib/logger";
import { downloadQrCodeAsPng, generateQrFilename } from "@/utils/qr-download";

interface ShareDetailsQrSectionProps {
  shareLink: string;
  shareName: string | undefined;
  onShowQrCode: () => void;
}

export function ShareDetailsQrSection({
  shareLink,
  shareName,
  onShowQrCode,
}: ShareDetailsQrSectionProps) {
  const t = useTranslations();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadQr = async () => {
    setIsDownloading(true);
    try {
      const filename = generateQrFilename(shareName);
      await downloadQrCodeAsPng("share-details-qr-code", filename);
    } catch (error) {
      logger.error("Failed to download QR code:", {
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <button
          type="button"
          className="text-base font-medium text-foreground cursor-pointer bg-transparent border-0 p-0"
          onClick={onShowQrCode}
        >
          {t("shareDetails.qrCode")}
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={handleDownloadQr}
          disabled={isDownloading}
          title={t("shareDetails.downloadQrCode")}
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex flex-col items-start justify-start ">
        <button
          type="button"
          className="p-2 bg-card rounded-lg cursor-pointer hover:opacity-80 transition-opacity duration-300 border-0"
          onClick={onShowQrCode}
          title={t("shareDetails.clickToEnlargeQrCode")}
        >
          <LazyQRCode
            id="share-details-qr-code"
            value={shareLink}
            size={100}
            level="H"
            fgColor="#000000"
            bgColor="#FFFFFF"
          />
        </button>
      </div>
    </div>
  );
}
