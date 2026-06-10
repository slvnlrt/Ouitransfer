import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { useQrDownload } from "@/hooks/use-qr-download";
import { generateQrFilename } from "@/utils/qr-download";

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareLink: string;
  shareName: string;
}

export function QrCodeModal({ isOpen, onClose, shareLink, shareName }: QrCodeModalProps) {
  const t = useTranslations();
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("qrCodeModal.title")}</DialogTitle>
          <DialogDescription>{t("qrCodeModal.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center">
          <div ref={qrContainerRef} className="p-4 bg-card rounded-lg">
            <LazyQRCode
              value={shareLink}
              size={256}
              level="H"
              fgColor="#000000"
              bgColor="#FFFFFF"
            />
          </div>
          <p className="mt-4 text-sm text-muted-foreground text-center max-w-full break-all">
            {shareLink}
          </p>
        </div>

        <DialogFooter className="sm:justify-between flex-row">
          <Button variant="outline" onClick={onClose} className="mt-2 sm:mt-0">
            {t("common.close")}
          </Button>
          <Button
            onClick={() => downloadQr(qrContainerRef.current, generateQrFilename(shareName))}
            className="mt-2 sm:mt-0"
            disabled={isDownloading}
          >
            <Download className="h-4 w-4" />
            {t("qrCodeModal.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
