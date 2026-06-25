"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQrDownload } from "@/hooks/use-qr-download";
import { generateQrFilename } from "@/utils/qr-download";

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
  const qrContainerRef = useRef<HTMLButtonElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();

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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={() => downloadQr(qrContainerRef.current, generateQrFilename(shareName))}
              disabled={isDownloading}
            >
              <Download className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("shareDetails.downloadQrCode")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col items-start justify-start ">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={qrContainerRef}
              type="button"
              className="p-2 bg-card rounded-lg cursor-pointer hover:opacity-80 transition-opacity duration-300 border-0"
              onClick={onShowQrCode}
            >
              <LazyQRCode
                value={shareLink}
                size={100}
                level="H"
                fgColor="#000000"
                bgColor="#FFFFFF"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("shareDetails.clickToEnlargeQrCode")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
