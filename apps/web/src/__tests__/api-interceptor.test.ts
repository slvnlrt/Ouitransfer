import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import apiInstance, {
  __resetRedirectingForTest,
  AUTH_API_PREFIXES,
  REDIRECT_SAFETY_TIMEOUT_MS,
} from "@/config/api";

describe("401 response interceptor", () => {
  let mock: MockAdapter;

  // Capture location.href assignments
  const locationHrefSetter = vi.fn();

  beforeEach(() => {
    mock = new MockAdapter(apiInstance);
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
