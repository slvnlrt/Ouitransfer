import { describe, expect, it, vi } from "vitest";

let mockOauthHosts = "";

// Top-level mock of the env to satisfy Zod validation at module load time
// Resolves relative to this test file to point to src/env.ts (../../env.js)
vi.mock("../../env.js", () => ({
  env: {
    JWT_SECRET: "a]test-jwt-secret-32-chars-long!",
    CSRF_SECRET: "b]test-csrf-secret-32-chars-long!",
    COOKIE_SECRET: "c]test-cookie-secret-32-chars-long!",
    get OAUTH_ALLOWED_REDIRECT_HOSTS() {
      return mockOauthHosts;
    },
  },
}));

import {
  __resetAllowedRedirectHostsForTest,
  isAllowedRedirectUrl,
} from "../redirect-validation.js";

describe("isAllowedRedirectUrl (Server)", () => {
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

  it("allows custom OIDC redirect hosts from env", () => {
    // Mutate the mock state dynamically via the getter
    mockOauthHosts = "auth.acme.example.com,login.corp.net";

    // Reset allowed redirect hosts cache to force rebuilding with the new mocked getter value
    __resetAllowedRedirectHostsForTest();

    expect(
      isAllowedRedirectUrl("https://auth.acme.example.com/auth", "https://app.example.com/api/x"),
    ).toBe(true);
    expect(
      isAllowedRedirectUrl("https://login.corp.net/callback", "https://app.example.com/api/x"),
    ).toBe(true);

    // Clean up/restore
    mockOauthHosts = "";
    __resetAllowedRedirectHostsForTest();
  });
});
