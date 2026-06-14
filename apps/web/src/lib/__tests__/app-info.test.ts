/**
 * @vitest-environment node
 *
 * Tests for getBaseUrl host-header trust (A7-05).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable header map backing the mocked next/headers.
let mockHeaderMap: Record<string, string | undefined> = {};

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => mockHeaderMap[key.toLowerCase()] ?? null,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getBaseUrl } from "../app-info";

describe("getBaseUrl (A7-05)", () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    mockHeaderMap = {};
    delete process.env.APP_URL;
  });

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    vi.clearAllMocks();
  });

  it("uses the configured canonical APP_URL verbatim and ignores X-Forwarded-Host", async () => {
    process.env.APP_URL = "https://transfer.example.com";
    mockHeaderMap = {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      host: "evil.example",
    };
    expect(await getBaseUrl()).toBe("https://transfer.example.com");
  });

  it("strips any path from APP_URL to a bare origin", async () => {
    process.env.APP_URL = "https://transfer.example.com/subpath";
    expect(await getBaseUrl()).toBe("https://transfer.example.com");
  });

  it("ignores a non-http(s) APP_URL and falls back to the host header", async () => {
    process.env.APP_URL = "javascript:alert(1)";
    mockHeaderMap = { host: "real.example" };
    expect(await getBaseUrl()).toBe("http://real.example");
  });

  it("does NOT trust X-Forwarded-Host when no canonical is configured (uses host header)", async () => {
    mockHeaderMap = {
      "x-forwarded-host": "evil.example",
      host: "real.example",
    };
    // The poisoning header is ignored; the connection host wins.
    expect(await getBaseUrl()).toBe("http://real.example");
  });

  it("honors x-forwarded-proto=https for the fallback scheme only", async () => {
    mockHeaderMap = { host: "real.example", "x-forwarded-proto": "https" };
    expect(await getBaseUrl()).toBe("https://real.example");
  });

  it("defaults to http + localhost when nothing is set", async () => {
    expect(await getBaseUrl()).toBe("http://localhost:3000");
  });
});
