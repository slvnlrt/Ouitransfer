/**
 * env-secret-gate.test.ts
 *
 * A8-01 — env.ts refuses to boot in production with a known shipped placeholder
 * secret or a low-entropy secret, while dev/test (and high-entropy production
 * secrets) boot unchanged.
 *
 * env.ts runs `refinedEnvSchema.parse(process.env)` at import time, so each case
 * uses vi.resetModules() + vi.stubEnv() + dynamic import to get a fresh parse.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// High-entropy, distinct, ≥32-char secrets that must always pass.
const STRONG = {
  JWT: "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9",
  CSRF: "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8",
  COOKIE: "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7",
  ENCRYPTION: "En3-w8Tj1uAd5oPq2Rb9Lf6Hc4Zx0VgN6",
};

function stubStrongSecrets() {
  vi.stubEnv("JWT_SECRET", STRONG.JWT);
  vi.stubEnv("CSRF_SECRET", STRONG.CSRF);
  vi.stubEnv("COOKIE_SECRET", STRONG.COOKIE);
  vi.stubEnv("ENCRYPTION_SECRET", STRONG.ENCRYPTION);
}

async function importEnv() {
  return import("../env.js");
}

describe("env.ts secret gate (A8-01)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("boots in production with strong, distinct secrets", async () => {
    stubStrongSecrets();
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).resolves.toBeDefined();
  });

  it("refuses to boot in production when JWT_SECRET is a known shipped placeholder", async () => {
    stubStrongSecrets();
    vi.stubEnv("JWT_SECRET", "dev-jwt-secret-do-not-use-in-production!!");
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).rejects.toThrow(/placeholder/i);
  });

  it("refuses to boot in production when COOKIE_SECRET is a known shipped placeholder", async () => {
    stubStrongSecrets();
    vi.stubEnv("COOKIE_SECRET", "dev-cookie-secret-not-for-production!");
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).rejects.toThrow(/placeholder/i);
  });

  it("refuses to boot in production on a low-entropy secret", async () => {
    stubStrongSecrets();
    // Passes the min(32) length check but has 1 distinct char / ~0 entropy.
    vi.stubEnv("JWT_SECRET", "a".repeat(40));
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).rejects.toThrow(/entropy/i);
  });

  it("rejects a known S3 credential placeholder in production", async () => {
    stubStrongSecrets();
    vi.stubEnv("S3_ACCESS_KEY", "ouitransfer");
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).rejects.toThrow(/placeholder/i);
  });

  it("ALLOWS the same low-entropy/placeholder values in development (gate is production-only)", async () => {
    // The exact dev placeholder values must still boot under NODE_ENV=development.
    vi.stubEnv("JWT_SECRET", "dev-jwt-secret-ouitransfer-32chars!");
    vi.stubEnv("CSRF_SECRET", "dev-csrf-secret-ouitransfer-32char!");
    vi.stubEnv("COOKIE_SECRET", "dev-cookie-secret-ouitransfer-32ch");
    vi.stubEnv("ENCRYPTION_SECRET", "dev-encryption-secret-ouitransfer-32c");
    vi.stubEnv("NODE_ENV", "development");
    await expect(importEnv()).resolves.toBeDefined();
  });

  it("enforces mutual distinctness (ENCRYPTION_SECRET must differ from JWT_SECRET)", async () => {
    stubStrongSecrets();
    vi.stubEnv("ENCRYPTION_SECRET", STRONG.JWT);
    vi.stubEnv("NODE_ENV", "production");
    await expect(importEnv()).rejects.toThrow(/different from JWT_SECRET/i);
  });
});
