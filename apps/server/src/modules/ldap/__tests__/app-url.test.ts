/**
 * app-url.test.ts — canonical http(s):// origin validation for LDAP welcome
 * links (A5-13).
 */

import { describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

import { assertSafeAppUrl, isCanonicalHttpOrigin } from "../app-url.js";

describe("isCanonicalHttpOrigin", () => {
  it("accepts http and https origins", () => {
    expect(isCanonicalHttpOrigin("https://transfer.example.com")).toBe(true);
    expect(isCanonicalHttpOrigin("http://transfer.example.com:8080")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isCanonicalHttpOrigin("javascript:alert(1)")).toBe(false);
    expect(isCanonicalHttpOrigin("ftp://example.com")).toBe(false);
    expect(isCanonicalHttpOrigin("data:text/html,x")).toBe(false);
  });

  it("rejects URLs carrying userinfo (host-spoofing)", () => {
    expect(isCanonicalHttpOrigin("https://evil.example@transfer.example.com")).toBe(false);
  });

  it("rejects unparseable values", () => {
    expect(isCanonicalHttpOrigin("not a url")).toBe(false);
    expect(isCanonicalHttpOrigin("")).toBe(false);
  });
});

describe("assertSafeAppUrl", () => {
  it("does not throw for a canonical origin", () => {
    expect(() => assertSafeAppUrl("https://transfer.example.com")).not.toThrow();
  });

  it("throws for a non-http appUrl (credential link would go to a bad host)", () => {
    expect(() => assertSafeAppUrl("javascript:alert(1)")).toThrow(/not a valid http/i);
  });

  it("warns when the appUrl origin diverges from the configured origin", () => {
    warn.mockClear();
    assertSafeAppUrl("https://ldap-host.example.com", "https://transfer.example.com");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        ldapAppUrl: "https://ldap-host.example.com",
        configuredAppUrl: "https://transfer.example.com",
      }),
      expect.stringMatching(/diverges/i),
    );
  });

  it("does not warn when origins match", () => {
    warn.mockClear();
    assertSafeAppUrl("https://transfer.example.com", "https://transfer.example.com/sub/path");
    expect(warn).not.toHaveBeenCalled();
  });
});
