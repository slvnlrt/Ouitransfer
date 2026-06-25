/**
 * spam-guard.test.ts (R5 — A6-03 / A4-10)
 *
 * Unit tests for the per-user outbound-email anti-spam guards: the per-share
 * recipient ceiling and the rolling-window / burst email quota.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEmailJobCount } = vi.hoisted(() => ({
  mockEmailJobCount: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    emailJob: { count: (...args: unknown[]) => mockEmailJobCount(...args) },
  },
}));

import {
  assertEmailQuotaAvailable,
  assertRecipientCountWithinLimit,
  EMAIL_BURST_MAX,
  EMAIL_QUOTA_PER_DAY,
  MAX_RECIPIENTS_PER_SHARE,
} from "../spam-guard.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmailJobCount.mockResolvedValue(0);
});

describe("assertRecipientCountWithinLimit", () => {
  it("allows up to the ceiling", () => {
    expect(() => assertRecipientCountWithinLimit(MAX_RECIPIENTS_PER_SHARE)).not.toThrow();
    expect(() => assertRecipientCountWithinLimit(0)).not.toThrow();
  });

  it("rejects beyond the ceiling with a 400", () => {
    try {
      assertRecipientCountWithinLimit(MAX_RECIPIENTS_PER_SHARE + 1);
      throw new Error("expected assertRecipientCountWithinLimit to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
      expect((err as Error).message).toMatch(/at most/i);
    }
  });
});

describe("assertEmailQuotaAvailable", () => {
  it("no-ops for a non-positive count (never queries)", async () => {
    await expect(assertEmailQuotaAvailable("user-1", 0)).resolves.toBeUndefined();
    expect(mockEmailJobCount).not.toHaveBeenCalled();
  });

  it("allows when both windows are within budget", async () => {
    // First call (day window) and second call (burst window) both return 0.
    mockEmailJobCount.mockResolvedValue(0);
    await expect(assertEmailQuotaAvailable("user-1", 10)).resolves.toBeUndefined();
    expect(mockEmailJobCount).toHaveBeenCalledTimes(2);
  });

  it("rejects with 429 when the daily quota would be exceeded", async () => {
    // Day window already at the cap, burst window empty.
    mockEmailJobCount.mockResolvedValueOnce(EMAIL_QUOTA_PER_DAY).mockResolvedValueOnce(0);

    try {
      await assertEmailQuotaAvailable("user-1", 1);
      throw new Error("expected assertEmailQuotaAvailable to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(429);
      expect((err as Error).message).toMatch(/daily email limit/i);
    }
  });

  it("rejects with 429 when the burst cap would be exceeded", async () => {
    // Day window within budget, burst window already at the cap.
    mockEmailJobCount.mockResolvedValueOnce(0).mockResolvedValueOnce(EMAIL_BURST_MAX);

    try {
      await assertEmailQuotaAvailable("user-1", 1);
      throw new Error("expected assertEmailQuotaAvailable to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(429);
      expect((err as Error).message).toMatch(/short period/i);
    }
  });

  it("counts the additional amount against the cap (fan-out aware)", async () => {
    // 1 below the daily cap, but a fan-out of 5 would exceed it.
    mockEmailJobCount.mockResolvedValueOnce(EMAIL_QUOTA_PER_DAY - 1).mockResolvedValueOnce(0);

    await expect(assertEmailQuotaAvailable("user-1", 5)).rejects.toThrow(/daily email limit/i);
  });
});
