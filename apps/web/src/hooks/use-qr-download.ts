"use client";

import { useCallback, useState } from "react";

import { logger } from "@/lib/logger";
import { downloadQrCodeAsPng } from "@/utils/qr-download";

/**
 * Shared behaviour for downloading a rendered QR code as a PNG.
 *
 * Pass the element wrapping the QR `<svg>` (e.g. the container of a
 * `LazyQRCode`) to `downloadQr`. The hook locates the SVG inside that
 * container at download time, so it works with multiple QR codes on the same
 * page and never relies on a global DOM id.
 *
 * The container element type is left to the caller (div, button, …), so each
 * component keeps its own correctly-typed ref.
 */
export function useQrDownload() {
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadQr = useCallback(async (container: HTMLElement | null, filename: string) => {
    const svg = container?.querySelector("svg");
    if (!svg) return;

    setIsDownloading(true);
    try {
      await downloadQrCodeAsPng(svg, filename);
    } catch (error) {
      logger.error("Failed to download QR code", {
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsDownloading(false);
    }
  }, []);

  return { isDownloading, downloadQr };
}
