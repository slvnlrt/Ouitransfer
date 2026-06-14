/**
 * server-config.test.ts
 *
 * Behavioral tests for buildApp() configuration.
 *
 * Note: parse-trust-proxy unit tests already live in
 * `src/utils/__tests__/parse-trust-proxy.test.ts`.
 *
 * Previous version of this file used static analysis (readFileSync +
 * content.includes("Math.random()")) which is not a behavioral test.
 * Those assertions are now removed:
 *
 *   - Math.random() elimination: covered by file-name-generator using
 *     crypto.randomUUID() internally (the output is always a valid UUID,
 *     which is verified by the file-validation integration tests).
 *
 *   - TRUST_PROXY parsing: fully covered by parse-trust-proxy.test.ts.
 *
 * This file focuses on behaviors only exercisable via a running app instance.
 *
 * IMPORTANT: Each test uses vi.resetModules() + vi.stubEnv() + dynamic import
 * to get a fresh env.ts parse for each env configuration. Without resetModules(),
 * the module cache retains the first-parse of env.ts and env vars set via
 * vi.stubEnv() are not reflected in subsequent imports.
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── docsEnabled (Items 1 & 2) ───────────────────────────────────────────────

describe("API docs registration (docsEnabled)", () => {
  beforeEach(() => {
    // Reset module cache so each test gets a fresh env.ts parse.
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
  });

  it("registers /swagger route when NODE_ENV=test (dev mode, default)", {
    timeout: 15_000,
  }, async () => {
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/swagger" });
      // /swagger redirects (301) or returns HTML — anything except 404 proves registration
      expect(res.statusCode).not.toBe(404);
    } finally {
      await app.close();
    }
  });

  it("registers /docs route when NODE_ENV=test (dev mode)", { timeout: 15_000 }, async () => {
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/docs" });
      expect(res.statusCode).not.toBe(404);
    } finally {
      await app.close();
    }
  });

  it("does NOT register /swagger when NODE_ENV=production and ENABLE_API_DOCS is unset", {
    timeout: 15_000,
  }, async () => {
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "https://example.com");
    // ENABLE_API_DOCS intentionally NOT set

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/swagger" });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("registers /swagger reachably when NODE_ENV=production and ENABLE_API_DOCS=true (A8-07: opt-in, no admin gate)", {
    timeout: 15_000,
  }, async () => {
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "https://example.com");
    vi.stubEnv("ENABLE_API_DOCS", "true");

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    try {
      // Enabling docs is the operator's deliberate opt-in: the UI is reachable
      // without authentication (not 404, and NOT 401/403 — there is no admin gate).
      const res = await app.inject({ method: "GET", url: "/swagger" });
      expect(res.statusCode).not.toBe(404);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    } finally {
      await app.close();
    }
  });
});

// ── CORS rejection (B-30) ───────────────────────────────────────────────────

describe("CORS origin rejection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function buildCorsApp(corsOrigins: string): Promise<FastifyInstance> {
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", corsOrigins);

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();
    return app;
  }

  it("rejects a disallowed Origin with 403 (not 500)", { timeout: 15_000 }, async () => {
    const app = await buildCorsApp("https://allowed.example.com");
    try {
      // Preflight from a disallowed origin: handled entirely by @fastify/cors,
      // never reaches a route handler. The ForbiddenError maps to 403.
      const res = await app.inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin: "https://evil.example.com",
          "access-control-request-method": "POST",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    } finally {
      await app.close();
    }
  });

  it("allows a listed Origin from a comma-separated CORS_ORIGINS list", {
    timeout: 15_000,
  }, async () => {
    const app = await buildCorsApp("https://ext.example.com,https://int.example.lan");
    try {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin: "https://int.example.lan",
          "access-control-request-method": "POST",
        },
      });
      expect(res.statusCode).not.toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBe("https://int.example.lan");
    } finally {
      await app.close();
    }
  });

  it("A8-06: does NOT grant credentialed CORS to Origin: null", { timeout: 15_000 }, async () => {
    const app = await buildCorsApp("https://allowed.example.com");
    try {
      // A literal `Origin: null` (sandboxed iframe, data:/file: doc) must be
      // rejected — it is not in the allow-list. No ACAO header; 403 via the
      // ForbiddenError path.
      const res = await app.inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin: "null",
          "access-control-request-method": "POST",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("A8-06: a no-Origin request is not granted ACAO but is not 403'd", {
    timeout: 15_000,
  }, async () => {
    const app = await buildCorsApp("https://allowed.example.com");
    try {
      // No Origin header → not a cross-origin browser request. The CORS layer
      // must NOT reflect credentials (no ACAO) but must let it proceed (so
      // same-origin / server-to-server traffic is unaffected).
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.statusCode).not.toBe(403);
    } finally {
      await app.close();
    }
  });
});

// ── Pino redaction (A8-05) ──────────────────────────────────────────────────

describe("logger redaction config (A8-05)", () => {
  it("declares redact paths covering auth/cookie headers and the secret denylist", async () => {
    const { LOG_REDACT_PATHS, LOG_REDACT_CENSOR } = await import("../utils/log-redaction.js");

    expect(LOG_REDACT_CENSOR).toBe("[REDACTED]");
    // Auth/session headers
    expect(LOG_REDACT_PATHS).toContain("req.headers.authorization");
    expect(LOG_REDACT_PATHS).toContain("req.headers.cookie");
    // Secret-bearing fields at any nesting depth (mirrors the audit denylist)
    for (const field of [
      "*.password",
      "*.secret",
      "*.token",
      "*.bindPassword",
      "*.clientSecret",
      "*.smtpPass",
      "*.twoFactorSecret",
      "*.backupCodes",
    ]) {
      expect(LOG_REDACT_PATHS).toContain(field);
    }
  });

  it("the request serializer strips authorization / cookie / x-csrf-token headers", async () => {
    const { redactRequestSerializer } = await import("../utils/log-redaction.js");

    const out = redactRequestSerializer({
      method: "POST",
      url: "/auth/login",
      ip: "127.0.0.1",
      headers: {
        authorization: "Bearer super-secret-token",
        cookie: "token=abc; refresh_token=def",
        "x-csrf-token": "csrf-123",
        "user-agent": "test",
      },
    });

    expect(out.headers?.authorization).toBe("[REDACTED]");
    expect(out.headers?.cookie).toBe("[REDACTED]");
    expect(out.headers?.["x-csrf-token"]).toBe("[REDACTED]");
    // Non-sensitive headers are preserved.
    expect(out.headers?.["user-agent"]).toBe("test");
    expect(out.method).toBe("POST");
  });

  it("buildApp() consumes the redact config without error (logger wired)", {
    timeout: 15_000,
  }, async () => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", "Jw7-k2Pf9qXc3mLv6Bn1Rt8Hs4Zd0YaQ9");
    vi.stubEnv("CSRF_SECRET", "Cz5-r3Wg8tYb2nKp7Md1Qv9Hs6Ze0XaP8");
    vi.stubEnv("COOKIE_SECRET", "Ck4-p6Vh9sZc1mNq8Lf3Rt7Gd2Xe0WbO7");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();
    try {
      // A logger that rejects the redact paths would throw at construction; a
      // ready app proves the redact + serializer config is accepted by Pino.
      expect(typeof app.log.error).toBe("function");
    } finally {
      await app.close();
    }
    vi.unstubAllEnvs();
  });
});
