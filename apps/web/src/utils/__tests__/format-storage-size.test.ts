import { describe, expect, it } from "vitest";
import { formatStorageSize } from "@/utils/format-storage-size";

describe("formatStorageSize", () => {
  it("returns '0 B' for zero", () => {
    expect(formatStorageSize(0)).toBe("0 B");
  });

  it("formats gigabytes (>= 1 GB)", () => {
    expect(formatStorageSize(1)).toBe("1.00 GB");
    expect(formatStorageSize(2.5)).toBe("2.50 GB");
    expect(formatStorageSize(100)).toBe("100.00 GB");
  });

  it("formats megabytes (< 1 GB, >= 1 MB)", () => {
    expect(formatStorageSize(0.5)).toBe("512.00 MB");
    expect(formatStorageSize(0.001)).toBe("1.02 MB");
  });

  it("formats kilobytes (< 1 MB, >= 1 KB)", () => {
    expect(formatStorageSize(0.000001)).toBe("1.05 KB");
  });

  it("formats bytes (< 1 KB)", () => {
    expect(formatStorageSize(0.0000001)).toBe("107 B");
  });
});
