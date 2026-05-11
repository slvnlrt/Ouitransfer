import { describe, expect, it } from "vitest";
import {
  BLOCKED_MIME_TYPES,
  DANGEROUS_EXTENSIONS,
  isMimeTypeConsistent,
  verifyMagicBytes,
} from "../validate-file-content.js";

describe("isMimeTypeConsistent (5.1)", () => {
  it("accepts matching MIME type and extension", () => {
    expect(isMimeTypeConsistent("image/jpeg", "jpg")).toBe(true);
    expect(isMimeTypeConsistent("image/png", "png")).toBe(true);
    expect(isMimeTypeConsistent("application/pdf", "pdf")).toBe(true);
  });

  it("rejects executable extension with benign MIME type", () => {
    expect(isMimeTypeConsistent("image/jpeg", "exe")).toBe(false);
    expect(isMimeTypeConsistent("image/png", "js")).toBe(false);
  });

  it("accepts unknown extensions (no false positives)", () => {
    expect(isMimeTypeConsistent("application/octet-stream", "bin")).toBe(true);
  });

  it("rejects blocked MIME types regardless of extension", () => {
    expect(isMimeTypeConsistent("application/x-executable", "jpg")).toBe(false);
    expect(isMimeTypeConsistent("application/x-msdownload", "pdf")).toBe(false);
  });

  it("allows when mimeType is undefined (optional field)", () => {
    expect(isMimeTypeConsistent(undefined, "jpg")).toBe(true);
  });

  it("is case-insensitive for MIME types and extensions", () => {
    expect(isMimeTypeConsistent("IMAGE/JPEG", "EXE")).toBe(false);
    expect(isMimeTypeConsistent("application/X-EXECUTABLE", "jpg")).toBe(false);
  });

  it("handles extension with leading dot", () => {
    expect(isMimeTypeConsistent("image/jpeg", ".exe")).toBe(false);
    expect(isMimeTypeConsistent("application/pdf", ".pdf")).toBe(true);
  });

  it("accepts non-dangerous extensions with any MIME type", () => {
    expect(isMimeTypeConsistent("application/octet-stream", "pdf")).toBe(true);
    expect(isMimeTypeConsistent("application/octet-stream", "docx")).toBe(true);
  });
});

describe("BLOCKED_MIME_TYPES and DANGEROUS_EXTENSIONS exports", () => {
  it("exports BLOCKED_MIME_TYPES as a Set", () => {
    expect(BLOCKED_MIME_TYPES).toBeInstanceOf(Set);
    expect(BLOCKED_MIME_TYPES.has("application/x-executable")).toBe(true);
    expect(BLOCKED_MIME_TYPES.has("application/x-msdownload")).toBe(true);
    expect(BLOCKED_MIME_TYPES.has("application/x-sh")).toBe(true);
  });

  it("exports DANGEROUS_EXTENSIONS as a Set", () => {
    expect(DANGEROUS_EXTENSIONS).toBeInstanceOf(Set);
    expect(DANGEROUS_EXTENSIONS.has("exe")).toBe(true);
    expect(DANGEROUS_EXTENSIONS.has("ps1")).toBe(true);
    expect(DANGEROUS_EXTENSIONS.has("sh")).toBe(true);
  });
});

describe("verifyMagicBytes (5.1)", () => {
  it("returns valid:true when declaredMime is undefined", async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    const result = await verifyMagicBytes(buffer, undefined);
    expect(result.valid).toBe(true);
  });

  it("returns valid:true for matching JPEG buffer and declared mime", async () => {
    // JPEG magic bytes + minimal valid structure
    const jpegBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const result = await verifyMagicBytes(jpegBuffer, "image/jpeg");
    expect(result.valid).toBe(true);
  });

  it("returns valid:true when file-type cannot detect format (text files, CSVs)", async () => {
    // Plain text has no magic bytes
    const textBuffer = Buffer.from("hello, world\nthis is a csv line\n");
    const result = await verifyMagicBytes(textBuffer, "text/plain");
    expect(result.valid).toBe(true);
  });

  it("returns valid:false for major MIME type mismatch", async () => {
    // Minimal valid PNG (signature + IHDR chunk) but declared as audio/mpeg
    const pngBuffer = Buffer.concat([
      // PNG signature
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      // IHDR chunk length (13 bytes)
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      // IHDR type
      Buffer.from([0x49, 0x48, 0x44, 0x52]),
      // width (1), height (1)
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
      // bit depth (8), color type (2=RGB), compression, filter, interlace
      Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]),
      // CRC (dummy, but enough for file-type to detect)
      Buffer.from([0x90, 0x77, 0x53, 0xde]),
    ]);
    const result = await verifyMagicBytes(pngBuffer, "audio/mpeg");
    expect(result.valid).toBe(false);
    expect(result.detected).toBe("image/png");
    expect(result.declared).toBe("audio/mpeg");
  });

  it("accepts image/jpg as equivalent to image/jpeg", async () => {
    const jpegBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const result = await verifyMagicBytes(jpegBuffer, "image/jpg");
    expect(result.valid).toBe(true);
  });

  it("accepts same major type (image/webp declared vs image/png detected)", async () => {
    // Minimal valid PNG but claiming image/webp → same major type → valid
    const pngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from([0x49, 0x48, 0x44, 0x52]),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
      Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]),
      Buffer.from([0x90, 0x77, 0x53, 0xde]),
    ]);
    const result = await verifyMagicBytes(pngBuffer, "image/webp");
    expect(result.valid).toBe(true);
  });
});
