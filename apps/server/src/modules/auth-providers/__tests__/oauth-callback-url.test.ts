/**
 * oauth-callback-url.test.ts — server-fixed callback + return-path (A5-04 / A6-01).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(async (key: string) =>
    key === "appUrl" ? "https://transfer.example.com" : null,
  ),
}));

import { getAppOrigin, getOAuthCallbackUrl, sanitizeReturnPath } from "../oauth-callback-url.js";

describe("getOAuthCallbackUrl / getAppOrigin", () => {
  afterEach(() => vi.clearAllMocks());

  it("builds the callback URL from the trusted appUrl, not the request host", async () => {
    const url = await getOAuthCallbackUrl("google");
    expect(url).toBe("https://transfer.example.com/api/auth/providers/google/callback");
  });

  it("returns the app origin", async () => {
    expect(await getAppOrigin()).toBe("https://transfer.example.com");
  });
});

describe("sanitizeReturnPath", () => {
  it("defaults to /dashboard when empty", () => {
    expect(sanitizeReturnPath(undefined)).toBe("/dashboard");
    expect(sanitizeReturnPath("")).toBe("/dashboard");
  });

  it("allows a safe relative path", () => {
    expect(sanitizeReturnPath("/shares")).toBe("/shares");
    expect(sanitizeReturnPath("/files?open=1")).toBe("/files?open=1");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeReturnPath("https://evil.tld/")).toBe("/dashboard");
    expect(sanitizeReturnPath("http://evil.tld")).toBe("/dashboard");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(sanitizeReturnPath("//evil.tld")).toBe("/dashboard");
    expect(sanitizeReturnPath("/\\evil.tld")).toBe("/dashboard");
    expect(sanitizeReturnPath("/path\\x")).toBe("/dashboard");
  });

  it("rejects scheme-bearing relative-looking values", () => {
    expect(sanitizeReturnPath("/javascript:alert(1)")).toBe("/dashboard");
  });
});
