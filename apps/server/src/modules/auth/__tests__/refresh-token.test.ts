import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { prisma } from "../../../shared/prisma.js";
import {
  cleanupExpiredTokens,
  createRefreshToken,
  revokeAllUserTokens,
  rotateRefreshToken,
} from "../refresh-token.service.js";

describe("Refresh token service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createRefreshToken", () => {
    it("creates a token with correct fields", async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue({
        id: "rt-1",
        token: "generated-token",
      } as never);

      const token = await createRefreshToken("user-1", "Chrome", "10.0.0.1");

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          userAgent: "Chrome",
          ipAddress: "10.0.0.1",
        }),
      });
      // Token is a base64url string of 32 bytes
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });

    it("sets expiry ~7 days in the future", async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

      const before = Date.now();
      await createRefreshToken("user-1");
      const after = Date.now();

      const call = vi.mocked(prisma.refreshToken.create).mock.calls[0][0];
      const expiresAt = (call.data as { expiresAt: Date }).expiresAt.getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(before + sevenDays - 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + sevenDays + 1000);
    });
  });

  describe("rotateRefreshToken", () => {
    it("rejects unknown tokens", async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

      await expect(rotateRefreshToken("nonexistent")).rejects.toThrow("Invalid refresh token");
    });

    it("detects replay (already-revoked token) and revokes all user tokens", async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        id: "rt-1",
        token: "old-token",
        userId: "user-1",
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: true },
      } as never);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 5 } as never);

      await expect(rotateRefreshToken("old-token")).rejects.toThrow("Refresh token reuse detected");
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects expired tokens", async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        id: "rt-1",
        token: "expired-token",
        userId: "user-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000), // expired
        user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: true },
      } as never);

      await expect(rotateRefreshToken("expired-token")).rejects.toThrow("Refresh token expired");
    });

    it("rejects tokens for inactive users", async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        id: "rt-1",
        token: "valid-token",
        userId: "user-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "user-1", tokenVersion: 0, isAdmin: false, isActive: false },
      } as never);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as never);

      await expect(rotateRefreshToken("valid-token")).rejects.toThrow("Account is inactive");
    });

    it("rotates valid token: revokes old, creates new, returns user info", async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        id: "rt-1",
        token: "valid-token",
        userId: "user-1",
        userAgent: "Chrome",
        ipAddress: "10.0.0.1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: "user-1", tokenVersion: 3, isAdmin: true, isActive: true },
      } as never);

      const newTokenRecord = {
        id: "rt-2",
        token: "new-token-value",
        userId: "user-1",
      };
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, newTokenRecord] as never);

      const result = await rotateRefreshToken("valid-token");

      expect(result.refreshToken).toBe("new-token-value");
      expect(result.userId).toBe("user-1");
      expect(result.tokenVersion).toBe(3);
      expect(result.isAdmin).toBe(true);

      // Verify transaction was called with an array of 2 Prisma operations
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown;
      expect(Array.isArray(txArg)).toBe(true);
      expect((txArg as unknown[]).length).toBe(2);
    });
  });

  describe("revokeAllUserTokens", () => {
    it("revokes all active tokens for a user", async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 3 } as never);

      await revokeAllUserTokens("user-1");

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe("cleanupExpiredTokens", () => {
    it("deletes tokens expired more than 24h ago", async () => {
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 5 } as never);

      const before = Date.now();
      const count = await cleanupExpiredTokens();
      const after = Date.now();

      expect(count).toBe(5);

      const call = vi.mocked(prisma.refreshToken.deleteMany).mock.calls[0][0];
      const cutoff = (
        (call as { where: { expiresAt: { lt: Date } } }).where.expiresAt.lt as Date
      ).getTime();
      const oneDayAgo = 24 * 60 * 60 * 1000;

      expect(cutoff).toBeGreaterThanOrEqual(before - oneDayAgo - 1000);
      expect(cutoff).toBeLessThanOrEqual(after - oneDayAgo + 1000);
    });
  });
});
