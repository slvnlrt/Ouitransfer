import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockGetConfigValue } = vi.hoisted(() => ({
  mockGetConfigValue: vi.fn(),
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buildResetPasswordUrl,
  buildShareLink,
  buildShareManageUrl,
  buildUnsubscribeUrl,
  getAppUrl,
  invalidateAppUrlCache,
} from "../url-builder.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("url-builder", () => {
  beforeEach(() => {
    invalidateAppUrlCache();
    mockGetConfigValue.mockReset();
  });

  afterEach(() => {
    invalidateAppUrlCache();
  });

  // ── getAppUrl ──────────────────────────────────────────────────────────────

  describe("getAppUrl", () => {
    it("returns configured value", async () => {
      mockGetConfigValue.mockResolvedValueOnce("https://transfer.example.com");

      const url = await getAppUrl();
      expect(url).toBe("https://transfer.example.com");
    });

    it("throws when config key is missing", async () => {
      mockGetConfigValue.mockRejectedValueOnce(new Error("Configuration appUrl not found"));

      await expect(getAppUrl()).rejects.toThrow();
    });

    it("throws when appUrl is empty string", async () => {
      mockGetConfigValue.mockResolvedValueOnce("");

      await expect(getAppUrl()).rejects.toThrow("appUrl is not configured or empty");
    });

    it("reads config on every call (no caching)", async () => {
      mockGetConfigValue
        .mockResolvedValueOnce("https://transfer.example.com")
        .mockResolvedValueOnce("https://transfer.example.com");

      const url1 = await getAppUrl();
      const url2 = await getAppUrl();

      expect(url1).toBe("https://transfer.example.com");
      expect(url2).toBe("https://transfer.example.com");
      // No caching — reads fresh on every call so admin config changes take effect immediately
      expect(mockGetConfigValue).toHaveBeenCalledTimes(2);
    });

    it("reflects config changes immediately (no cache invalidation needed)", async () => {
      mockGetConfigValue
        .mockResolvedValueOnce("https://old.example.com")
        .mockResolvedValueOnce("https://new.example.com");

      const url1 = await getAppUrl();
      expect(url1).toBe("https://old.example.com");

      // No need to call invalidateAppUrlCache() — the value is fresh on every call
      const url2 = await getAppUrl();
      expect(url2).toBe("https://new.example.com");
      expect(mockGetConfigValue).toHaveBeenCalledTimes(2);
    });
  });

  // ── buildShareLink ─────────────────────────────────────────────────────────

  describe("buildShareLink", () => {
    beforeEach(() => {
      mockGetConfigValue.mockResolvedValue("https://transfer.example.com");
    });

    it("builds link without tracking token", async () => {
      const url = await buildShareLink("abc123");
      expect(url).toBe("https://transfer.example.com/s/abc123");
    });

    it("builds link with tracking token", async () => {
      const url = await buildShareLink("abc123", "track-456");
      expect(url).toBe("https://transfer.example.com/s/abc123?t=track-456");
    });
  });

  // ── buildShareManageUrl ────────────────────────────────────────────────────

  describe("buildShareManageUrl", () => {
    it("returns correct path", async () => {
      mockGetConfigValue.mockResolvedValue("https://transfer.example.com");

      const url = await buildShareManageUrl("share-id-789");
      expect(url).toBe("https://transfer.example.com/shares/share-id-789");
    });
  });

  // ── buildResetPasswordUrl ──────────────────────────────────────────────────

  describe("buildResetPasswordUrl", () => {
    it("returns correct path", async () => {
      mockGetConfigValue.mockResolvedValue("https://transfer.example.com");

      const url = await buildResetPasswordUrl("reset-token-abc");
      expect(url).toBe("https://transfer.example.com/auth/reset-password/reset-token-abc");
    });
  });

  // ── buildUnsubscribeUrl ────────────────────────────────────────────────────

  describe("buildUnsubscribeUrl", () => {
    it("returns correct path with token", async () => {
      mockGetConfigValue.mockResolvedValue("https://transfer.example.com");

      const url = await buildUnsubscribeUrl("jwt-token-xyz");
      expect(url).toBe(
        "https://transfer.example.com/api/notifications/unsubscribe?token=jwt-token-xyz",
      );
    });
  });
});
