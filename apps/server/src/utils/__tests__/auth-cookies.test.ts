/**
 * Unit tests for auth-cookies utilities.
 *
 * Because `env` is a module-level singleton (parsed at import time), each
 * group of tests that needs a different SECURE_SITE value uses
 * vi.resetModules() + dynamic import to get a fresh parse.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal FastifyReply mock that records setCookie / clearCookie calls. */
function makeMockReply() {
  const calls: {
    setCookie: Array<{ name: string; value: string; options: Record<string, unknown> }>;
    clearCookie: Array<{ name: string; options: Record<string, unknown> }>;
  } = { setCookie: [], clearCookie: [] };

  const reply = {
    setCookie: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
      calls.setCookie.push({ name, value, options });
      return reply;
    }),
    clearCookie: vi.fn((name: string, options: Record<string, unknown>) => {
      calls.clearCookie.push({ name, options });
      return reply;
    }),
    _calls: calls,
  };

  return reply;
}

/** Minimal FastifyRequest mock for getClientInfo. */
function makeMockRequest(
  overrides: {
    headers?: Record<string, string | undefined>;
    ip?: string;
    socketRemoteAddress?: string;
  } = {},
) {
  return {
    headers: overrides.headers ?? {},
    ip: overrides.ip ?? "",
    socket: { remoteAddress: overrides.socketRemoteAddress ?? "" },
  };
}

// ── Required env stubs (needed for env.ts to parse without errors) ────────────
const BASE_ENV = {
  JWT_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  COOKIE_SECRET: "c".repeat(32),
};

// ── setAuthCookies ────────────────────────────────────────────────────────────

describe("setAuthCookies (SECURE_SITE=true)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", BASE_ENV.JWT_SECRET);
    vi.stubEnv("CSRF_SECRET", BASE_ENV.CSRF_SECRET);
    vi.stubEnv("COOKIE_SECRET", BASE_ENV.COOKIE_SECRET);
    vi.stubEnv("SECURE_SITE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the access-token cookie with correct options when secure", async () => {
    const { setAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    setAuthCookies(reply as never, {
      accessToken: "jwt.access.token",
      refreshToken: "opaque-refresh-token",
    });

    const tokenCall = reply._calls.setCookie.find((c) => c.name === "token");
    expect(tokenCall).toBeDefined();
    expect(tokenCall?.value).toBe("jwt.access.token");
    expect(tokenCall?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      secure: true,
      sameSite: "lax",
      signed: true,
    });
    // No maxAge — session cookie
    expect(tokenCall?.options.maxAge).toBeUndefined();
  });

  it("sets the refresh-token cookie with correct options when secure", async () => {
    const { setAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    setAuthCookies(reply as never, {
      accessToken: "jwt.access.token",
      refreshToken: "opaque-refresh-token",
    });

    const refreshCall = reply._calls.setCookie.find((c) => c.name === "refresh_token");
    expect(refreshCall).toBeDefined();
    expect(refreshCall?.value).toBe("opaque-refresh-token");
    expect(refreshCall?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60,
      signed: false,
    });
  });

  it("calls setCookie exactly twice (once per cookie)", async () => {
    const { setAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    setAuthCookies(reply as never, {
      accessToken: "jwt.access.token",
      refreshToken: "opaque-refresh-token",
    });

    expect(reply.setCookie).toHaveBeenCalledTimes(2);
  });
});

describe("setAuthCookies (SECURE_SITE=false)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", BASE_ENV.JWT_SECRET);
    vi.stubEnv("CSRF_SECRET", BASE_ENV.CSRF_SECRET);
    vi.stubEnv("COOKIE_SECRET", BASE_ENV.COOKIE_SECRET);
    vi.stubEnv("SECURE_SITE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets secure=false and sameSite=strict for access-token cookie when not secure", async () => {
    const { setAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    setAuthCookies(reply as never, {
      accessToken: "jwt.access.token",
      refreshToken: "opaque-refresh-token",
    });

    const tokenCall = reply._calls.setCookie.find((c) => c.name === "token");
    expect(tokenCall?.options).toMatchObject({
      secure: false,
      sameSite: "strict",
    });
  });

  it("sets secure=false for refresh-token cookie when not secure", async () => {
    const { setAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    setAuthCookies(reply as never, {
      accessToken: "jwt.access.token",
      refreshToken: "opaque-refresh-token",
    });

    const refreshCall = reply._calls.setCookie.find((c) => c.name === "refresh_token");
    expect(refreshCall?.options).toMatchObject({
      secure: false,
    });
  });
});

// ── clearAuthCookies ──────────────────────────────────────────────────────────

describe("clearAuthCookies", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", BASE_ENV.JWT_SECRET);
    vi.stubEnv("CSRF_SECRET", BASE_ENV.CSRF_SECRET);
    vi.stubEnv("COOKIE_SECRET", BASE_ENV.COOKIE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clears the token cookie with path /", async () => {
    const { clearAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    clearAuthCookies(reply as never);

    const tokenClear = reply._calls.clearCookie.find((c) => c.name === "token");
    expect(tokenClear).toBeDefined();
    expect(tokenClear?.options).toEqual({ path: "/" });
  });

  it("clears the refresh_token cookie with its scoped path", async () => {
    const { clearAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    clearAuthCookies(reply as never);

    const refreshClear = reply._calls.clearCookie.find((c) => c.name === "refresh_token");
    expect(refreshClear).toBeDefined();
    expect(refreshClear?.options).toEqual({ path: "/api/auth/refresh" });
  });

  it("calls clearCookie exactly twice", async () => {
    const { clearAuthCookies } = await import("../auth-cookies.js");
    const reply = makeMockReply();

    clearAuthCookies(reply as never);

    expect(reply.clearCookie).toHaveBeenCalledTimes(2);
  });
});

// ── getClientInfo ─────────────────────────────────────────────────────────────

describe("getClientInfo", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", BASE_ENV.JWT_SECRET);
    vi.stubEnv("CSRF_SECRET", BASE_ENV.CSRF_SECRET);
    vi.stubEnv("COOKIE_SECRET", BASE_ENV.COOKIE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts user-agent from standard header", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: { "user-agent": "Mozilla/5.0 TestBrowser" },
      ip: "192.168.1.1",
    });

    const { userAgent, ipAddress } = getClientInfo(request as never);

    expect(userAgent).toBe("Mozilla/5.0 TestBrowser");
    expect(ipAddress).toBe("192.168.1.1");
  });

  it("prefers x-user-agent over standard user-agent header", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: {
        "user-agent": "proxy-agent",
        "x-user-agent": "real-client-agent",
      },
      ip: "10.0.0.1",
    });

    const { userAgent } = getClientInfo(request as never);

    expect(userAgent).toBe("real-client-agent");
  });

  it("prefers x-real-ip over request.ip", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: { "x-real-ip": "203.0.113.42" },
      ip: "10.0.0.1",
    });

    const { ipAddress } = getClientInfo(request as never);

    expect(ipAddress).toBe("203.0.113.42");
  });

  it("falls back to request.socket.remoteAddress when request.ip is empty", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: {},
      ip: "",
      socketRemoteAddress: "127.0.0.1",
    });

    const { ipAddress } = getClientInfo(request as never);

    expect(ipAddress).toBe("127.0.0.1");
  });

  it("returns empty strings when no IP or user-agent info is available", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: {},
      ip: "",
      socketRemoteAddress: "",
    });

    const { userAgent, ipAddress } = getClientInfo(request as never);

    expect(userAgent).toBe("");
    expect(ipAddress).toBe("");
  });

  it("extracts both IP and user-agent from proxy headers simultaneously", async () => {
    const { getClientInfo } = await import("../auth-cookies.js");
    const request = makeMockRequest({
      headers: {
        "x-real-ip": "198.51.100.5",
        "x-user-agent": "CustomApp/1.0",
        "user-agent": "nginx/1.24",
      },
      ip: "172.16.0.1",
    });

    const { ipAddress, userAgent } = getClientInfo(request as never);

    expect(ipAddress).toBe("198.51.100.5");
    expect(userAgent).toBe("CustomApp/1.0");
  });
});
