import { describe, expect, it } from "vitest";

import { isSafeHttpUrl, safeHttpUrlOrHash } from "../safe-url";

describe("isSafeHttpUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isSafeHttpUrl("https://example.com")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/path?q=1#frag")).toBe(true);
    expect(isSafeHttpUrl("https://sub.example.com:8443/x")).toBe(true);
  });

  it("rejects javascript: / data: / vbscript: schemes (A7-01)", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com")).toBe(false);
  });

  it("rejects protocol-relative URLs (//evil)", () => {
    expect(isSafeHttpUrl("//evil.com")).toBe(false);
  });

  it("rejects URLs with control characters (CR/LF/TAB)", () => {
    expect(isSafeHttpUrl("https://example.com\n")).toBe(false);
    expect(isSafeHttpUrl("java\tscript:alert(1)")).toBe(false);
  });

  it("rejects empty/nullish values", () => {
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });

  it("rejects non-URL garbage", () => {
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("example.com")).toBe(false);
  });
});

describe("safeHttpUrlOrHash", () => {
  it("returns the URL when safe", () => {
    expect(safeHttpUrlOrHash("https://example.com")).toBe("https://example.com");
  });

  it("falls back to '#' when unsafe (A7-01 footer link disabled)", () => {
    expect(safeHttpUrlOrHash("javascript:alert(1)")).toBe("#");
    expect(safeHttpUrlOrHash("//evil.com")).toBe("#");
    expect(safeHttpUrlOrHash("")).toBe("#");
    expect(safeHttpUrlOrHash(null)).toBe("#");
  });
});
