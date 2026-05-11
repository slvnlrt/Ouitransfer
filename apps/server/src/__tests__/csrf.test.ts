import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("CSRF protection (5.4)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a".repeat(32));
    vi.stubEnv("CSRF_SECRET", "b".repeat(32));
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

    // Simulates a public mutation endpoint (like /auth/login) — should be exempt
    // We'll test actual exempt routes via the exemption list in the hook config
    app.post("/auth/login", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    app.post("/auth/forgot-password", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    app.post("/auth/2fa/login", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    app.post("/auth/reset-password", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    app.post("/register-with-invite", async (_req, reply) => {
      return reply.send({ ok: true });
    });

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
});
