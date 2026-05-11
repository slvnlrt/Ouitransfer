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

  it("registers /swagger route when NODE_ENV=test (dev mode, default)", async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
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

  it("registers /docs route when NODE_ENV=test (dev mode)", async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
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

  it("does NOT register /swagger when NODE_ENV=production and ENABLE_API_DOCS is unset", async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
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

  it("registers /swagger when NODE_ENV=production and ENABLE_API_DOCS=true", async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
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
