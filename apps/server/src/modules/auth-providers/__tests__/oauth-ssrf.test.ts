/**
 * oauth-ssrf.test.ts — SSRF guard for OAuth egress (A5-05 OAuth portion).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SsrfValidationError } from "../../../utils/ssrf-guard.js";
import { assertOAuthUrlAllowed, ssrfSafeFetch } from "../oauth-ssrf.js";

describe("assertOAuthUrlAllowed", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("rejects the cloud metadata endpoint", () => {
    expect(() => assertOAuthUrlAllowed("http://169.254.169.254/latest/meta-data/")).toThrow(
      SsrfValidationError,
    );
  });

  it("rejects loopback hosts", () => {
    expect(() => assertOAuthUrlAllowed("http://127.0.0.1/token")).toThrow(SsrfValidationError);
    expect(() => assertOAuthUrlAllowed("http://localhost/token")).toThrow(SsrfValidationError);
  });

  it("rejects private RFC1918 hosts", () => {
    expect(() => assertOAuthUrlAllowed("http://10.0.0.5/token")).toThrow(SsrfValidationError);
    expect(() => assertOAuthUrlAllowed("http://192.168.1.10/token")).toThrow(SsrfValidationError);
    expect(() => assertOAuthUrlAllowed("http://172.16.9.9/token")).toThrow(SsrfValidationError);
  });

  it("allows a normal public https endpoint", () => {
    expect(() => assertOAuthUrlAllowed("https://accounts.google.com/o/oauth2/token")).not.toThrow();
  });

  it("allows a private host when OAUTH_ALLOW_PRIVATE_ENDPOINT=true", async () => {
    vi.stubEnv("OAUTH_ALLOW_PRIVATE_ENDPOINT", "true");
    // env.ts caches the parsed value at import; re-import a fresh module instance.
    vi.resetModules();
    const mod = await import("../oauth-ssrf.js");
    expect(() => mod.assertOAuthUrlAllowed("http://192.168.1.10/token")).not.toThrow();
    // metadata still blocked even with the escape hatch (message check — the
    // re-imported module has its own SsrfValidationError class identity).
    expect(() => mod.assertOAuthUrlAllowed("http://169.254.169.254/")).toThrow(/metadata/i);
    vi.resetModules();
  });

  it("ssrfSafeFetch refuses an internal host before connecting", async () => {
    // The guard must throw BEFORE any network call is made.
    await expect(ssrfSafeFetch("http://169.254.169.254/latest/")).rejects.toThrow(
      SsrfValidationError,
    );
    await expect(ssrfSafeFetch("http://127.0.0.1:9000/")).rejects.toThrow(SsrfValidationError);
  });
});
