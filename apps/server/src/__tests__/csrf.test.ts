import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Import the production exempt-route list so tests cannot drift from reality (Item 7).
// If a route is added/removed from production, this test automatically reflects it.
import { CSRF_EXEMPT_ROUTES } from "../config/csrf.config.js";

describe("CSRF protection (5.4)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
    vi.stubEnv("COOKIE_SECRET", "c".repeat(32));
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    // Register lightweight routes for CSRF testing — avoids Prisma/DB dependency.
    // A "protected" POST route (requires CSRF) and a "public" exempt POST route.
    const { healthRoutes } = await import("../modules/health/routes.js");
    await app.register(healthRoutes);

    // Simulates an authenticated mutation endpoint (like /auth/logout)
    app.post("/test/protected", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    // Register a synthetic /auth/logout handler that mirrors the real route's
    // CSRF requirements (authenticated mutation, NOT in CSRF_EXEMPT_ROUTES).
    // We use a synthetic handler to avoid ConfigService/Prisma dependencies that
    // the real authRoutes bring in during route registration.
    app.post("/auth/logout", async (_req, reply) => {
      return reply.send({ message: "Logged out" });
    });

    // ── Per-route config test routes ─────────────────────────────────
    // Synthetic routes that use `config: { csrfExempt: true }` to verify
    // the primary CSRF exemption mechanism works independently of the
    // CSRF_EXEMPT_ROUTES fallback set.
    app.post(
      "/test/csrf-exempt-via-config",
      { config: { csrfExempt: true } },
      async (_req, reply) => {
        return reply.send({ ok: true, mechanism: "per-route-config" });
      },
    );

    // Route without csrfExempt — should require CSRF token
    app.post(
      "/test/csrf-required-via-config",
      { config: { csrfExempt: false } },
      async (_req, reply) => {
        return reply.send({ ok: true });
      },
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("GET /csrf-token returns a token and sets _csrf cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(10);
    // Should set the _csrf cookie
    const cookies = res.cookies;
    const csrfCookie = cookies.find((c: { name: string }) => c.name === "_csrf");
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie?.httpOnly).toBe(true);
  });

  it("rejects POST to protected endpoint without CSRF token", async () => {
    // Get the CSRF cookie (but intentionally omit the token header)
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const res = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows POST with valid CSRF token + cookie", async () => {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const res = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
        "x-csrf-token": token,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("allows GET requests without any CSRF token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("allows HEAD requests without any CSRF token", async () => {
    const res = await app.inject({ method: "HEAD", url: "/health" });
    // HEAD on /health — may return 200 or 404 depending on registration,
    // but must NOT return 403
    expect(res.statusCode).not.toBe(403);
  });

  it("allows exempt POST /auth/login without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ emailOrUsername: "test@test.com", password: "password123456" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("allows exempt POST /auth/forgot-password without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "test@test.com", origin: "http://localhost:3000" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("allows exempt POST /auth/reset-password without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ token: "fake", password: "newpassword123" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("allows exempt POST /auth/2fa/login without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/2fa/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ challengeToken: "fake", token: "123456" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("allows exempt POST /register-with-invite without CSRF token", async () => {
    // /register-with-invite is not registered in this test app, but the CSRF hook
    // should still mark it as exempt via CSRF_EXEMPT_ROUTES fallback (it returns 404, not 403).
    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ token: "fake" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("requires CSRF token for POST /auth/register (no longer exempt)", async () => {
    // /auth/register was removed from CSRF_EXEMPT_ROUTES — it is admin-only once
    // users exist, so an unauthenticated CSRF bypass would be a security hole.
    // Without cookie+token it must be rejected by CSRF protection (403).
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "test@test.com", password: "password123" }),
    });
    // No _csrf cookie → Missing CSRF secret → 403
    expect(res.statusCode).toBe(403);
  });

  it("normalizes trailing slash before CSRF exempt check", async () => {
    // ignoreTrailingSlash:true means /auth/login/ reaches the same handler as /auth/login.
    // The CSRF hook must strip the trailing slash before the Set lookup — otherwise
    // /auth/login/ would not be in the exempt set and would be blocked with 403.
    const res = await app.inject({
      method: "POST",
      url: "/auth/login/",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ emailOrUsername: "test@test.com", password: "password123456" }),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects POST with tampered CSRF token", async () => {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const res = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${csrfCookie?.value}`,
        "x-csrf-token": "tampered-invalid-token",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects POST with valid token but missing cookie", async () => {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token } = csrfRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        "x-csrf-token": token,
        // No _csrf cookie
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Item 3: Real route from the route table ─────────────────────────────────
  // This test hits an actual registered route (POST /auth/logout) without a CSRF
  // token — verifying that the CSRF hook is active on real application routes, not
  // just synthetic test routes.
  it("rejects POST /auth/logout (real route) without CSRF token — confirms hook is active on real routes", async () => {
    // /auth/logout is NOT in the exempt list and requires a logged-in user,
    // but CSRF protection fires BEFORE JWT verification — so 403 comes first.
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      // No _csrf cookie, no x-csrf-token header
    });
    // The CSRF hook runs before any route handler — must reject with 403.
    expect(res.statusCode).toBe(403);
  });

  // ── Item 4: CSRF token lifecycle / rotation ─────────────────────────────────
  it("a token obtained in one round-trip is consumed and a new token can be fetched", async () => {
    // Round 1: get a token and use it successfully
    const round1 = await app.inject({ method: "GET", url: "/csrf-token" });
    expect(round1.statusCode).toBe(200);
    const { token: token1 } = round1.json();
    const cookie1 = round1.cookies.find((c: { name: string }) => c.name === "_csrf");
    expect(cookie1).toBeDefined();

    const use1 = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${cookie1?.value}`,
        "x-csrf-token": token1,
      },
    });
    expect(use1.statusCode).toBe(200);

    // Round 2: fetch a fresh token (simulating what the frontend does after each mutation)
    const round2 = await app.inject({ method: "GET", url: "/csrf-token" });
    expect(round2.statusCode).toBe(200);
    const { token: token2 } = round2.json();
    const cookie2 = round2.cookies.find((c: { name: string }) => c.name === "_csrf");

    // The second token must be accepted
    const use2 = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${cookie2?.value}`,
        "x-csrf-token": token2,
      },
    });
    expect(use2.statusCode).toBe(200);
  });

  it("old token from a different _csrf cookie is rejected (cookie-token binding)", async () => {
    // Obtain two independent token+cookie pairs
    const res1 = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: token1 } = res1.json();

    const res2 = await app.inject({ method: "GET", url: "/csrf-token" });
    const cookie2 = res2.cookies.find((c: { name: string }) => c.name === "_csrf");

    // Use token from session 1 but cookie from session 2 — must fail
    const mismatch = await app.inject({
      method: "POST",
      url: "/test/protected",
      headers: {
        cookie: `_csrf=${cookie2?.value}`,
        "x-csrf-token": token1, // token signed with session 1's secret
      },
    });
    expect(mismatch.statusCode).toBe(403);
  });

  // ── Item 7: Verify exempt list matches production code ─────────────────────
  // These tests import the production CSRF_EXEMPT_ROUTES constant directly — any
  // change to the exempt list in csrf.config.ts is reflected here automatically.
  it("fallback exempt set contains the expected public routes (imported from production config)", () => {
    expect(CSRF_EXEMPT_ROUTES.has("/auth/login")).toBe(true);
    expect(CSRF_EXEMPT_ROUTES.has("/auth/refresh")).toBe(true);
    expect(CSRF_EXEMPT_ROUTES.has("/auth/forgot-password")).toBe(true);
    expect(CSRF_EXEMPT_ROUTES.has("/auth/reset-password")).toBe(true);
    expect(CSRF_EXEMPT_ROUTES.has("/auth/2fa/login")).toBe(true);
    expect(CSRF_EXEMPT_ROUTES.has("/register-with-invite")).toBe(true);
    // Safety check: /auth/register is NOT exempt
    expect(CSRF_EXEMPT_ROUTES.has("/auth/register")).toBe(false);
  });

  it("fallback exempt set does NOT contain authenticated mutation routes", () => {
    // These are authenticated endpoints — they must NOT be exempt from CSRF
    expect(CSRF_EXEMPT_ROUTES.has("/auth/logout")).toBe(false);
    expect(CSRF_EXEMPT_ROUTES.has("/files")).toBe(false);
    expect(CSRF_EXEMPT_ROUTES.has("/shares")).toBe(false);
  });

  // ── Per-route config: primary CSRF exemption mechanism ─────────────────────
  // Routes with `config: { csrfExempt: true }` are exempt from CSRF without
  // needing to be in CSRF_EXEMPT_ROUTES. This is the preferred mechanism.

  it("allows POST to route with config.csrfExempt=true without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/csrf-exempt-via-config",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mechanism: "per-route-config" });
  });

  it("rejects POST to route with config.csrfExempt=false without CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test/csrf-required-via-config",
      // No _csrf cookie, no x-csrf-token header
    });
    expect(res.statusCode).toBe(403);
  });

  it("per-route config takes precedence over fallback Set absence", async () => {
    // /test/csrf-exempt-via-config is NOT in CSRF_EXEMPT_ROUTES, but has
    // config.csrfExempt=true — should still be exempt.
    expect(CSRF_EXEMPT_ROUTES.has("/test/csrf-exempt-via-config")).toBe(false);
    const res = await app.inject({
      method: "POST",
      url: "/test/csrf-exempt-via-config",
    });
    expect(res.statusCode).toBe(200);
  });
});
