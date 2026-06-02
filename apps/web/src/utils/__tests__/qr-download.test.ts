/**
 * Tests for qr-download.ts — generateQrFilename.
 *
 * downloadQrCodeAsPng is not unit-tested here: it depends on the canvas 2d
 * context and Image decoding, which jsdom does not implement. Its behaviour is
 * exercised through the QR download UI flows.
 */

import { describe, expect, it } from "vitest";

import { generateQrFilename } from "../qr-download";

describe("generateQrFilename", () => {
  it("slugifies a plain name", () => {
    expect(generateQrFilename("My Share")).toBe("my-share-qr-code.png");
  });

  it("replaces each non-alphanumeric character with a dash and lowercases", () => {
    expect(generateQrFilename("a/b C")).toBe("a-b-c-qr-code.png");
  });

  it("falls back to 'share' for nullish names", () => {
    expect(generateQrFilename(undefined)).toBe("share-qr-code.png");
    expect(generateQrFilename(null)).toBe("share-qr-code.png");
  });

  it("falls back when the name has no usable characters", () => {
    expect(generateQrFilename("")).toBe("share-qr-code.png");
  });

  it("uses a custom fallback when provided", () => {
    expect(generateQrFilename(undefined, "quickshare")).toBe("quickshare-qr-code.png");
    expect(generateQrFilename("", "reverse-share")).toBe("reverse-share-qr-code.png");
  });

  it("prefers a usable name over the fallback", () => {
    expect(generateQrFilename("Report", "quickshare")).toBe("report-qr-code.png");
  });
});
