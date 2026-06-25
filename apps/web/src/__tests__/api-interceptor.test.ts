import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import apiInstance, {
  __resetRedirectingForTest,
  AUTH_API_PREFIXES,
  REDIRECT_SAFETY_TIMEOUT_MS,
} from "@/config/api";

describe("401 response interceptor", () => {
  let mock: MockAdapter;
  let rawAxiosMock: MockAdapter;

  // Capture location.href assignments
  const locationHrefSetter = vi.fn();

  beforeEach(async () => {
    mock = new MockAdapter(apiInstance);
    // The 401 → refresh flow calls /api/auth/refresh via raw axios. These tests
    // exercise the SESSION-EXPIRED path, so the refresh must fail with an auth
    // rejection (a 401 *response*), not a network error — the latter is treated
    // as transient and (correctly) does not redirect.
    const axiosModule = await import("axios");
    rawAxiosMock = new MockAdapter(axiosModule.default);
    rawAxiosMock.onPost("/api/auth/refresh").reply(401, { error: "Session expired" });
    __resetRedirectingForTest();
    vi.useFakeTimers();

    // Mock window.location with a writable href
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard", href: "http://localhost/dashboard" },
      writable: true,
      configurable: true,
    });

    // Intercept href assignments
    Object.defineProperty(window.location, "href", {
      get: () => "http://localhost/dashboard",
      set: locationHrefSetter,
      configurable: true,
    });
  });

  afterEach(() => {
    mock.restore();
    rawAxiosMock.restore();
    vi.useRealTimers();
    locationHrefSetter.mockClear();
  });

  it("redirects to /login?reason=session_expired on 401 for protected page", async () => {
    mock.onGet("/api/files").reply(401);

    await expect(apiInstance.get("/api/files")).rejects.toThrow();

    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("does NOT redirect on 401 for auth endpoints", async () => {
    for (const prefix of AUTH_API_PREFIXES) {
      mock.onPost(prefix).reply(401);
      await expect(apiInstance.post(prefix, {})).rejects.toThrow();
    }

    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("does NOT redirect on 401 for public pages", async () => {
    // Simulate being on /login
    Object.defineProperty(window, "location", {
      value: { pathname: "/login", href: "http://localhost/login" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      get: () => "http://localhost/login",
      set: locationHrefSetter,
      configurable: true,
    });

    mock.onGet("/api/some-endpoint").reply(401);

    await expect(apiInstance.get("/api/some-endpoint")).rejects.toThrow();

    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("does NOT redirect on 401 for /s/ share pages (prefix path)", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/s/abc123", href: "http://localhost/s/abc123" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      get: () => "http://localhost/s/abc123",
      set: locationHrefSetter,
      configurable: true,
    });

    mock.onGet("/api/shares/abc123").reply(401);

    await expect(apiInstance.get("/api/shares/abc123")).rejects.toThrow();

    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("only redirects once for multiple simultaneous 401s", async () => {
    mock.onGet("/api/files").reply(401);
    mock.onGet("/api/folders").reply(401);

    const results = await Promise.allSettled([
      apiInstance.get("/api/files"),
      apiInstance.get("/api/folders"),
    ]);

    // Both should reject
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");

    // But only one redirect
    expect(locationHrefSetter).toHaveBeenCalledTimes(1);
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("resets isRedirecting after safety timeout", async () => {
    mock.onGet("/api/files").reply(401);
    mock.onGet("/api/folders").reply(401);

    await expect(apiInstance.get("/api/files")).rejects.toThrow();
    expect(locationHrefSetter).toHaveBeenCalledTimes(1);

    // Before timeout: second 401 should NOT trigger another redirect
    locationHrefSetter.mockClear();
    await expect(apiInstance.get("/api/folders")).rejects.toThrow();
    expect(locationHrefSetter).not.toHaveBeenCalled();

    // After safety timeout: the flag should be reset
    vi.advanceTimersByTime(REDIRECT_SAFETY_TIMEOUT_MS);

    await expect(apiInstance.get("/api/folders")).rejects.toThrow();
    expect(locationHrefSetter).toHaveBeenCalledTimes(1);
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("does NOT redirect on non-401 errors", async () => {
    mock.onGet("/api/files").reply(500);

    await expect(apiInstance.get("/api/files")).rejects.toThrow();

    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("uses matchesPath for public page detection (not plain startsWith)", async () => {
    // /loginadmin should NOT match /login with matchesPath
    Object.defineProperty(window, "location", {
      value: { pathname: "/loginadmin", href: "http://localhost/loginadmin" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      get: () => "http://localhost/loginadmin",
      set: locationHrefSetter,
      configurable: true,
    });

    mock.onGet("/api/protected").reply(401);

    await expect(apiInstance.get("/api/protected")).rejects.toThrow();

    // /loginadmin is NOT a public path, so redirect should happen
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });
});

describe("401 interceptor — refresh token flow (I-1)", () => {
  let mock: MockAdapter;
  let rawAxiosMock: MockAdapter;
  const locationHrefSetter = vi.fn();

  // We need to mock BOTH the apiInstance (for the original request)
  // AND the default axios instance (for the refresh call which uses raw axios).
  // Import the default axios used in api.ts for raw refresh calls.
  let rawAxios: typeof import("axios").default;

  beforeEach(async () => {
    const axiosModule = await import("axios");
    rawAxios = axiosModule.default;

    mock = new MockAdapter(apiInstance);
    rawAxiosMock = new MockAdapter(rawAxios);
    __resetRedirectingForTest();
    vi.useFakeTimers();

    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard", href: "http://localhost/dashboard" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      get: () => "http://localhost/dashboard",
      set: locationHrefSetter,
      configurable: true,
    });
  });

  afterEach(() => {
    mock.restore();
    rawAxiosMock.restore();
    vi.useRealTimers();
    locationHrefSetter.mockClear();
  });

  it("401 → successful refresh → retries original request", async () => {
    // First call to /api/files returns 401, retry returns 200
    let callCount = 0;
    mock.onGet("/api/files").reply(() => {
      callCount++;
      if (callCount === 1) return [401];
      return [200, { files: ["a.txt"] }];
    });

    // The refresh endpoint (called via raw axios) returns success
    // (refresh token is in httpOnly cookie — sent automatically by browser)
    rawAxiosMock.onPost("/api/auth/refresh").reply(200, { message: "Token refreshed" });

    const res = await apiInstance.get("/api/files");
    expect(res.status).toBe(200);
    expect(res.data.files).toEqual(["a.txt"]);
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("401 → failed refresh → redirects to login", async () => {
    mock.onGet("/api/files").reply(401);
    rawAxiosMock.onPost("/api/auth/refresh").reply(401, { error: "Invalid refresh token" });

    await expect(apiInstance.get("/api/files")).rejects.toThrow();
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("concurrent 401s → only one refresh attempt (mutex)", async () => {
    let refreshCallCount = 0;
    rawAxiosMock.onPost("/api/auth/refresh").reply(() => {
      refreshCallCount++;
      return [200, { message: "Token refreshed" }];
    });

    // Both endpoints: first call returns 401, retry (after refresh) returns 200
    let fileCallCount = 0;
    mock.onGet("/api/files").reply(() => {
      fileCallCount++;
      if (fileCallCount === 1) return [401];
      return [200, { files: [] }];
    });

    let folderCallCount = 0;
    mock.onGet("/api/folders").reply(() => {
      folderCallCount++;
      if (folderCallCount === 1) return [401];
      return [200, { folders: [] }];
    });

    const results = await Promise.allSettled([
      apiInstance.get("/api/files"),
      apiInstance.get("/api/folders"),
    ]);

    // Both should succeed via retry after refresh
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(2);

    // The critical assertion: only ONE refresh request was made (mutex deduplication)
    expect(refreshCallCount).toBe(1);
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("refresh endpoint 401 → no infinite loop, redirects to login", async () => {
    mock.onGet("/api/files").reply(401);
    // Refresh endpoint itself returns 401
    rawAxiosMock.onPost("/api/auth/refresh").reply(401, { error: "Token expired" });

    await expect(apiInstance.get("/api/files")).rejects.toThrow();

    // Should redirect to login, NOT loop forever
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
    // Only one redirect despite the chain of 401s
    expect(locationHrefSetter).toHaveBeenCalledTimes(1);
  });

  it("refresh attempt uses cookie (no body token), fails → redirects", async () => {
    mock.onGet("/api/files").reply(401);
    // The raw axios POST sends httpOnly cookie automatically via withCredentials.
    // In test env there's no real cookie, so this simulates the flow failing.
    rawAxiosMock.onPost("/api/auth/refresh").reply(401, { error: "Missing refresh token" });

    await expect(apiInstance.get("/api/files")).rejects.toThrow();

    // Attempted refresh (via cookie) failed → redirect
    expect(locationHrefSetter).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("401 → refresh NETWORK error → rejects with the network error (not the 401), no redirect", async () => {
    mock.onGet("/api/files").reply(401);
    // No response from the refresh endpoint (dead socket / offline) — transient.
    rawAxiosMock.onPost("/api/auth/refresh").networkError();

    // The original request must reject with the refresh's NETWORK error
    // (no response, status 0), NOT the original 401 — otherwise React Query's
    // retry guard would suppress retries for a transient failure.
    const err = await apiInstance.get("/api/files").catch((e) => e);
    expect(err.isAxiosError).toBe(true);
    expect(err.message).toBe("Network Error");
    expect(err.response).toBeUndefined();

    // A transient network failure must NOT log the user out.
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("401 → refresh TIMEOUT → does NOT redirect (transient), settles instead of hanging", async () => {
    mock.onGet("/api/files").reply(401);
    // The refresh request times out (no response) — transient, must settle.
    rawAxiosMock.onPost("/api/auth/refresh").timeout();

    await expect(apiInstance.get("/api/files")).rejects.toThrow();

    expect(locationHrefSetter).not.toHaveBeenCalled();
  });

  it("concurrent 401s → refresh network error → all settle, none redirect", async () => {
    mock.onGet("/api/files").reply(401);
    mock.onGet("/api/folders").reply(401);
    rawAxiosMock.onPost("/api/auth/refresh").networkError();

    const results = await Promise.allSettled([
      apiInstance.get("/api/files"),
      apiInstance.get("/api/folders"),
    ]);

    // Both settle (reject) — neither hangs forever — and no forced logout.
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(locationHrefSetter).not.toHaveBeenCalled();
  });
});
