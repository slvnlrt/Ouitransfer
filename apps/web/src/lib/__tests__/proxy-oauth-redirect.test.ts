import { describe, expect, it, vi } from "vitest";
import { __resetAllowedRedirectHostsForTest, isAllowedRedirectUrl } from "../proxy.js";

describe("isAllowedRedirectUrl (5.15)", () => {
  it("allows same-origin redirects", () => {
    expect(
      isAllowedRedirectUrl("https://app.example.com/callback", "https://app.example.com/api/x"),
    ).toBe(true);
  });

  it("allows all 6 built-in OAuth provider hostnames", () => {
    const requestUrl = "https://app.example.com/api/x";

    // Google
    expect(isAllowedRedirectUrl("https://accounts.google.com/o/oauth2/auth", requestUrl)).toBe(
      true,
    );
    // GitHub
    expect(isAllowedRedirectUrl("https://github.com/login/oauth/authorize", requestUrl)).toBe(true);
    // GitLab
    expect(isAllowedRedirectUrl("https://gitlab.com/oauth/authorize", requestUrl)).toBe(true);
    // Microsoft
    expect(
      isAllowedRedirectUrl(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        requestUrl,
      ),
    ).toBe(true);
    // Discord
    expect(isAllowedRedirectUrl("https://discord.com/api/oauth2/authorize", requestUrl)).toBe(true);
    // Spotify
    expect(isAllowedRedirectUrl("https://accounts.spotify.com/authorize", requestUrl)).toBe(true);
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

  it("rejects empty string URL", () => {
    expect(isAllowedRedirectUrl("", "https://app.example.com/api/x")).toBe(false);
  });

  it("rejects URLs that use an allowed host as credentials to redirect to an evil host", () => {
    // Attack pattern: https://allowed.host@evil.com/steal
    // The actual hostname is evil.com, not accounts.google.com
    expect(
      isAllowedRedirectUrl(
        "https://accounts.google.com@evil.com/steal",
        "https://app.example.com/api/x",
      ),
    ).toBe(false);
    expect(
      isAllowedRedirectUrl(
        "https://github.com@attacker.net/token-steal",
        "https://app.example.com/api/x",
      ),
    ).toBe(false);
  });

  // I-5: env-driven extension for custom OIDC providers
  it("allows custom OIDC redirect hosts from env", async () => {
    vi.resetModules();

    // Mock @/env with the custom hosts so the proxy module picks them up at load time
    vi.doMock("@/env", () => ({
      env: {
        JWT_SECRET: "a]#Fq9K!mZ3Tv&bW8xR2pL7jY0sN5dH6",
        API_BASE_URL: "http://localhost:3333",
        OAUTH_ALLOWED_REDIRECT_HOSTS: "auth.acme.example.com,login.corp.net",
        ALLOWED_IMAGE_HOSTS: undefined,
      },
    }));

    const { isAllowedRedirectUrl: isAllowed, __resetAllowedRedirectHostsForTest: reset } =
      await import("../proxy.js");

    // Reset cache so the new env value is picked up
    reset();

    expect(isAllowed("https://auth.acme.example.com/auth", "https://app.example.com/api/x")).toBe(
      true,
    );
    expect(isAllowed("https://login.corp.net/callback", "https://app.example.com/api/x")).toBe(
      true,
    );

    // Clean up
    vi.doUnmock("@/env");
    vi.resetModules();
    __resetAllowedRedirectHostsForTest();
  });
});
