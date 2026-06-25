import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing modules that use it
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import {
  incrementTokenVersion,
  invalidateTokenVersionCache,
  validateTokenVersion,
} from "../token-version.js";

describe("Token rotation (5.23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the internal cache between tests by invalidating a known key
    // and resetting timers
    invalidateTokenVersionCache("user-1");
    invalidateTokenVersionCache("user-2");
  });

  describe("validateTokenVersion", () => {
    it("rejects tokens without tokenVersion claim", async () => {
      const result = await validateTokenVersion(
        {} as never, // request (unused)
        { userId: "user-1" },
      );
      expect(result).toBe(false);
    });

    it("rejects tokens without userId claim", async () => {
      const result = await validateTokenVersion({} as never, { tokenVersion: 0 });
      expect(result).toBe(false);
    });

    it("accepts token when tokenVersion matches DB", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 0,
      } as never);

      const result = await validateTokenVersion({} as never, { userId: "user-1", tokenVersion: 0 });

      expect(result).toBe(true);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { tokenVersion: true },
      });
    });

    it("rejects token when tokenVersion does not match DB", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 1,
      } as never);

      const result = await validateTokenVersion({} as never, { userId: "user-1", tokenVersion: 0 });

      expect(result).toBe(false);
    });

    it("rejects token when user is not found (deleted)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await validateTokenVersion({} as never, {
        userId: "deleted-user",
        tokenVersion: 0,
      });

      expect(result).toBe(false);
    });

    it("uses cache on subsequent calls for the same user", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 0,
      } as never);

      // First call — cache miss, hits DB
      await validateTokenVersion({} as never, { userId: "user-2", tokenVersion: 0 });
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

      // Second call — cache hit, should NOT hit DB again
      await validateTokenVersion({} as never, { userId: "user-2", tokenVersion: 0 });
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it("rejects stale token after cache invalidation", async () => {
      // First: tokenVersion 0 in DB
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 0,
      } as never);

      const result1 = await validateTokenVersion({} as never, {
        userId: "user-1",
        tokenVersion: 0,
      });
      expect(result1).toBe(true);

      // Simulate tokenVersion increment
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 1,
      } as never);

      // Invalidate cache (as incrementTokenVersion would do)
      invalidateTokenVersionCache("user-1");

      // Old token (tokenVersion: 0) should now be rejected
      const result2 = await validateTokenVersion({} as never, {
        userId: "user-1",
        tokenVersion: 0,
      });
      expect(result2).toBe(false);

      // New token (tokenVersion: 1) should be accepted
      const result3 = await validateTokenVersion({} as never, {
        userId: "user-1",
        tokenVersion: 1,
      });
      expect(result3).toBe(true);
    });
  });

  describe("incrementTokenVersion", () => {
    it("increments tokenVersion in DB and invalidates cache", async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      // Prime the cache
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 0,
      } as never);
      await validateTokenVersion({} as never, { userId: "user-1", tokenVersion: 0 });

      // Increment
      await incrementTokenVersion("user-1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { tokenVersion: { increment: 1 } },
      });

      // Next validation should hit DB (cache was invalidated)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        tokenVersion: 1,
      } as never);

      const result = await validateTokenVersion({} as never, { userId: "user-1", tokenVersion: 0 });
      expect(result).toBe(false);

      // DB was queried again (not cached)
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
