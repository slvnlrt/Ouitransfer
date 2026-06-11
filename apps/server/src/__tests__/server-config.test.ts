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
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
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
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
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
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
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

  it("registers /swagger when NODE_ENV=production and ENABLE_API_DOCS=true", {
    timeout: 15_000,
  }, async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "https://example.com");
    vi.stubEnv("ENABLE_API_DOCS", "true");

    const { buildApp } = await import("../app.js");
    const app: FastifyInstance = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/swagger" });
      expect(res.statusCode).not.toBe(404);
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
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
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
});
