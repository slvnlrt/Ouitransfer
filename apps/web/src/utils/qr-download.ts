/**
 * Downloads a QR code SVG element as a high-resolution PNG image.
 *
 * Converts the given SVG element to a canvas-rendered PNG with a white quiet
 * zone, then triggers a download via a temporary anchor element. Because it
 * operates on an SVG element reference (not a global DOM id), it is inherently
 * safe to render multiple QR codes on the same page.
 *
 * The SVG is serialized through a Blob URL (rather than a base64 data URI) so
 * that QR payloads containing non-Latin1 characters do not break `btoa`.
 */
export function downloadQrCodeAsPng(svg: SVGElement, filename: string, size = 1024): Promise<void> {
  return new Promise((resolve, reject) => {
    const padding = Math.round(size * 0.1);
    const canvas = document.createElement("canvas");
    canvas.width = size + padding * 2;
    canvas.height = size + padding * 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get canvas 2d context"));
      return;
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      ctx.drawImage(img, padding, padding, size, size);
      URL.revokeObjectURL(url);

      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();

      resolve();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG as image"));
    };

    img.src = url;
  });
}

/**
 * Generates a safe filename for QR code downloads.
 *
 * Falls back to `fallback` (default `"share"`) when no usable name is provided.
 */
export function generateQrFilename(name: string | undefined | null, fallback = "share"): string {
  const safeName = name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() || fallback;
  return `${safeName}-qr-code.png`;
}
