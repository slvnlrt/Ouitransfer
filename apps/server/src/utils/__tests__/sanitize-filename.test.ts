import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "../sanitize-filename.js";

describe("sanitizeFilename (5.10)", () => {
  it("removes path separators", () => {
    expect(sanitizeFilename("path/to/file.txt")).toBe("file.txt");
    expect(sanitizeFilename("path\\to\\file.txt")).toBe("file.txt");
  });

  it("strips null bytes", () => {
    expect(sanitizeFilename("file\0name.txt")).toBe("filename.txt");
  });

  it("removes leading dots (hidden files)", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("...dotdot")).toBe("dotdot");
  });

  it("strips trailing dots and spaces (Windows FS safety — M-2)", () => {
    expect(sanitizeFilename("file.txt.")).toBe("file.txt");
    expect(sanitizeFilename("file.txt   ")).toBe("file.txt");
    expect(sanitizeFilename("file...")).toBe("file");
  });

  it("rejects Windows reserved names (M-2)", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("con.txt")).toBe("_con.txt");
    expect(sanitizeFilename("NUL")).toBe("_NUL");
    expect(sanitizeFilename("COM1")).toBe("_COM1");
    expect(sanitizeFilename("LPT3.log")).toBe("_LPT3.log");
    expect(sanitizeFilename("PRN")).toBe("_PRN");
  });

  it("allows normal filenames through unchanged", () => {
    expect(sanitizeFilename("my document (2024).pdf")).toBe("my document (2024).pdf");
    expect(sanitizeFilename("résumé.docx")).toBe("résumé.docx");
  });

  it("handles empty/falsy input", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("   ")).toBe("unnamed");
  });

  it("truncates to 255 bytes preserving UTF-8 code point boundaries", () => {
    const long = `${"a".repeat(300)}.txt`;
    const result = sanitizeFilename(long);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
  });

  it("truncates multi-byte filenames at code point boundary", () => {
    // Each emoji is 4 bytes. 64 emojis = 256 bytes, should be truncated cleanly.
    const emojis = `${"\u{1F600}".repeat(64)}.txt`;
    const result = sanitizeFilename(emojis);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
    // Should not end with a replacement character
    expect(result).not.toContain("\uFFFD");
  });
});
