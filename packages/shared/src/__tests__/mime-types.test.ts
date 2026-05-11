import { describe, expect, it } from "vitest";
import { extractFilenameFromContentDisposition } from "../mime-types.js";

describe("extractFilenameFromContentDisposition (5.17)", () => {
  it("prefers filename* over filename when both are present", () => {
    const header = `attachment; filename="ascii.txt"; filename*=UTF-8''utf8%20name.txt`;
    expect(extractFilenameFromContentDisposition(header)).toBe("utf8 name.txt");
  });

  it("falls back to filename when filename* is absent", () => {
    const header = `attachment; filename="fallback.txt"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("fallback.txt");
  });

  it("returns null when neither is present", () => {
    expect(extractFilenameFromContentDisposition("attachment")).toBeNull();
  });

  it("handles RFC 5987 UTF-8 encoded filename*", () => {
    const header = `attachment; filename*=UTF-8''caf%C3%A9.pdf`;
    expect(extractFilenameFromContentDisposition(header)).toBe("café.pdf");
  });

  it("handles unquoted filename fallback", () => {
    const header = `attachment; filename=simple.txt`;
    expect(extractFilenameFromContentDisposition(header)).toBe("simple.txt");
  });

  it("returns null for null input", () => {
    expect(extractFilenameFromContentDisposition(null)).toBeNull();
  });

  // M-3: non-UTF-8 charset falls through to plain filename
  it("ignores filename* with non-UTF-8 charset and falls back to filename", () => {
    const header = `attachment; filename*=ISO-8859-1''cafe.pdf; filename="fallback-cafe.pdf"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("fallback-cafe.pdf");
  });

  it("falls back to null when filename* is non-UTF-8 and no filename= present", () => {
    const header = `attachment; filename*=ISO-8859-1''cafe.pdf`;
    expect(extractFilenameFromContentDisposition(header)).toBeNull();
  });

  it("handles malformed percent-encoding gracefully", () => {
    const header = `attachment; filename*=UTF-8''bad%ZZname.txt; filename="good.txt"`;
    expect(extractFilenameFromContentDisposition(header)).toBe("good.txt");
  });
});
