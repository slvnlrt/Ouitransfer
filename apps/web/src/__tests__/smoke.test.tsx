/**
 * Smoke tests for core app utilities.
 *
 * Previously tested the third-party Button primitive (not meaningful).
 * Now covers actual app code:
 *   - formatFileSize: human-readable file size formatting
 */

import { describe, expect, it } from "vitest";

import { formatFileSize } from "@/utils/format-file-size";

describe("formatFileSize", () => {
  it("returns '0 B' for zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes (< 1 KB)", () => {
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(100 * 1024 * 1024)).toBe("100 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("rounds to one decimal place", () => {
    // 1100 bytes = ~1.07 KB, rounds to 1.1
    expect(formatFileSize(1100)).toBe("1.1 KB");
    // 1048576 + 104857 = ~1.1 MB
    expect(formatFileSize(1048576 + 104857)).toBe("1.1 MB");
  });
});
