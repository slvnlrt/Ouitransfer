import { describe, expect, it, vi } from "vitest";
import { __resetAllowedRedirectHostsForTest, isAllowedRedirectUrl } from "../proxy.js";

describe("isAllowedRedirectUrl (5.15)", () => {
  it("allows same-origin redirects", () => {
    expect(
      isAllowedRedirectUrl("https://app.example.com/callback", "https://app.example.com/api/x"),
    ).toBe(true);
  });

  it("allows known OAuth provider hostnames", () => {
    expect(
      isAllowedRedirectUrl(
        "https://accounts.google.com/o/oauth2/auth",
        "https://app.example.com/api/x",
      ),
    ).toBe(true);
    expect(
      isAllowedRedirectUrl(
        "https://github.com/login/oauth/authorize",
        "https://app.example.com/api/x",
      ),
    ).toBe(true);
  });

  it("rejects arbitrary external URLs", () => {
    expect(
      isAllowedRedirectUrl("https://evil.com/steal-token", "https://app.example.com/api/x"),
    ).toBe(false);
  });

  it("allows relative URLs (same origin implied)", () => {
    expect(isAllowedRedirectUrl("/callback?code=abc", "https://app.example.com/api/x")).toBe(true);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isAllowedRedirectUrl("//evil.com/steal", "https://app.example.com/api/x")).toBe(false);
  });

  it("handles malformed URLs gracefully", () => {
    expect(isAllowedRedirectUrl("not-a-url-at-all", "https://app.example.com/api/x")).toBe(false);
  });

  // I-5: env-driven extension for custom OIDC providers
  it("allows custom OIDC redirect hosts from env", () => {
    vi.stubEnv("OAUTH_ALLOWED_REDIRECT_HOSTS", "auth.acme.example.com,login.corp.net");
    // Reset the module-level cache so the new env value is picked up
    __resetAllowedRedirectHostsForTest();
    expect(
      isAllowedRedirectUrl("https://auth.acme.example.com/auth", "https://app.example.com/api/x"),
    ).toBe(true);
    expect(
      isAllowedRedirectUrl("https://login.corp.net/callback", "https://app.example.com/api/x"),
    ).toBe(true);
    vi.unstubAllEnvs();
    // Reset again after test so the cache doesn't bleed into subsequent tests
    __resetAllowedRedirectHostsForTest();
  });
});
