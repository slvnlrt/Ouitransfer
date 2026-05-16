/**
 * Downloads a QR code SVG element as a PNG image.
 *
 * Converts an SVG element to a canvas-rendered PNG with white padding,
 * then triggers a download via a temporary anchor element.
 */
export function downloadQrCodeAsPng(svgElementId: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const svg = document.getElementById(svgElementId);
    if (!svg) {
      reject(new Error(`SVG element with id "${svgElementId}" not found`));
      return;
    }

    const padding = 20;
    const qrSize = 200;
    const canvas = document.createElement("canvas");
    canvas.width = qrSize + padding * 2;
    canvas.height = qrSize + padding * 2;

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
      ctx.drawImage(img, padding, padding, qrSize, qrSize);
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
 */
export function generateQrFilename(name: string | undefined | null): string {
  const safeName = name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "share";
  return `${safeName}-qr-code.png`;
}
