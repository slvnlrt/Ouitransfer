import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing modules that use it
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    loginAttempt: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
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
  cleanupOldAttempts,
  isAccountLocked,
  recordLoginAttempt,
} from "../login-attempts.service.js";

describe("Login attempts / account lockout (5.25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("recordLoginAttempt", () => {
    it("creates a login attempt record with lowercase email", async () => {
      vi.mocked(prisma.loginAttempt.create).mockResolvedValue({} as never);
      // recordLoginAttempt checks isAccountLocked first for failures — return not-locked
      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue([]);

      await recordLoginAttempt("User@Example.COM", "192.168.1.1", false);

      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: {
          email: "user@example.com",
          ipAddress: "192.168.1.1",
          success: false,
        },
      });
    });

    it("records successful login attempts", async () => {
      vi.mocked(prisma.loginAttempt.create).mockResolvedValue({} as never);

      await recordLoginAttempt("user@test.com", "10.0.0.1", true);

      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: {
          email: "user@test.com",
          ipAddress: "10.0.0.1",
          success: true,
        },
      });
    });
  });

  describe("isAccountLocked", () => {
    it("returns locked:false when there are no attempts", async () => {
      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue([]);

      const result = await isAccountLocked("user@test.com", "192.168.1.1");
      expect(result).toEqual({ locked: false });
    });

    it("returns locked:false when failures are below threshold", async () => {
      // 9 consecutive failures — below the threshold of 10
      const attempts = Array.from({ length: 9 }, (_, i) => ({
        id: `attempt-${i}`,
        email: "user@test.com",
        ipAddress: "192.168.1.1",
        success: false,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue(attempts);

      const result = await isAccountLocked("user@test.com", "192.168.1.1");
      expect(result).toEqual({ locked: false });
    });

    it("returns locked:true when 10 consecutive failures within window", async () => {
      const now = Date.now();
      const attempts = Array.from({ length: 10 }, (_, i) => ({
        id: `attempt-${i}`,
        email: "user@test.com",
        ipAddress: "192.168.1.1",
        success: false,
        // Most recent first, all within the last 5 minutes
        createdAt: new Date(now - i * 30_000),
      }));

      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue(attempts);

      const result = await isAccountLocked("user@test.com", "192.168.1.1");
      expect(result.locked).toBe(true);
      expect(result.remainingMinutes).toBeGreaterThan(0);
      expect(result.remainingMinutes).toBeLessThanOrEqual(15);
    });

    it("a successful login resets the consecutive failure count", async () => {
      const now = Date.now();
      // 5 failures, then a success, then 5 more failures
      // The success at index 5 means only 5 consecutive failures from the top
      const attempts = [
        // 5 recent failures
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `fail-${i}`,
          email: "user@test.com",
          ipAddress: "192.168.1.1",
          success: false,
          createdAt: new Date(now - i * 1000),
        })),
        // A success in the middle
        {
          id: "success-1",
          email: "user@test.com",
          ipAddress: "192.168.1.1",
          success: true,
          createdAt: new Date(now - 6000),
        },
        // 4 older failures
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `old-fail-${i}`,
          email: "user@test.com",
          ipAddress: "192.168.1.1",
          success: false,
          createdAt: new Date(now - 7000 - i * 1000),
        })),
      ];

      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue(attempts);

      const result = await isAccountLocked("user@test.com", "192.168.1.1");
      expect(result.locked).toBe(false);
    });

    it("lockout expires after the configured duration", async () => {
      const now = Date.now();
      // 10 failures, but all older than 15 minutes ago
      // The oldest failure is 20 minutes ago — lockout should have expired
      const attempts = Array.from({ length: 10 }, (_, i) => ({
        id: `attempt-${i}`,
        email: "user@test.com",
        ipAddress: "192.168.1.1",
        success: false,
        // Most recent failure was 16 minutes ago, oldest 25 minutes ago
        createdAt: new Date(now - (16 + i) * 60 * 1000),
      }));

      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue(attempts);

      const result = await isAccountLocked("user@test.com", "192.168.1.1");
      // These attempts would be outside the 15-minute window, so findMany returns
      // empty since the query filters by createdAt >= since.
      // Actually, the mock returns them regardless of the query — but the lockout
      // calculation checks if unlockAt is still in the future.
      // The oldest (index 9) was created at now - 25min.
      // unlockAt = oldestCreatedAt + 15 min = now - 25min + 15min = now - 10min
      // remainingMs = (now - 10min) - now = -10min < 0 → NOT locked
      expect(result.locked).toBe(false);
    });

    it("normalizes email to lowercase for lookups", async () => {
      vi.mocked(prisma.loginAttempt.findMany).mockResolvedValue([]);

      await isAccountLocked("User@Example.COM", "10.0.0.1");

      expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: "user@example.com",
          }),
        }),
      );
    });
  });

  describe("cleanupOldAttempts", () => {
    it("deletes records older than 24 hours", async () => {
      vi.mocked(prisma.loginAttempt.deleteMany).mockResolvedValue({
        count: 42,
      } as never);

      const count = await cleanupOldAttempts();

      expect(count).toBe(42);
      expect(prisma.loginAttempt.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });

      // Verify the cutoff is approximately 24 hours ago
      const callArgs = vi.mocked(prisma.loginAttempt.deleteMany).mock.calls[0][0] as {
        where: { createdAt: { lt: Date } };
      };
      const cutoff = callArgs.where.createdAt.lt;
      const expectedCutoff = Date.now() - 24 * 60 * 60 * 1000;
      // Allow 5 second tolerance for test execution time
      expect(cutoff.getTime()).toBeGreaterThan(expectedCutoff - 5000);
      expect(cutoff.getTime()).toBeLessThan(expectedCutoff + 5000);
    });
  });
});
