/**
 * health.test.ts
 *
 * Unit tests for evaluateEmailHealth — verifies the four status states
 * (disabled / ok / degraded / down) and lastError selection.
 *
 * Both prisma and the config service are mocked; there is NO live SMTP probe,
 * so the function is fully exercised by mocking emailJob counts + findFirst and
 * the smtpEnabled config value.
 *
 * Mock path notes: vi.mock() specifiers resolve relative to THIS test file
 * (src/modules/email/__tests__/health.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../../utils/app-error.js";

const mockPrisma = vi.hoisted(() => ({
  emailJob: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

import { getConfigValue } from "../../config/service.js";
import { evaluateEmailHealth } from "../health.js";

/**
 * Stub the queue counts by inspecting each count() call's `where` clause, so the
 * test is robust to call ordering. `failedRecent` defaults to `failed` (i.e. all
 * failures are recent) unless overridden — that distinction is what drives the
 * windowed status derivation.
 */
function mockCounts({
  pending,
  sentLast24h,
  failed,
  failedRecent,
  digestPending,
}: {
  pending: number;
  sentLast24h: number;
  failed: number;
  failedRecent?: number;
  digestPending: number;
}): void {
  const recentFailed = failedRecent ?? failed;
  mockPrisma.emailJob.count.mockImplementation((args: { where: Record<string, unknown> }) => {
    const where = args.where;
    switch (where.status) {
      case "pending":
        return Promise.resolve(pending);
      case "sent":
        return Promise.resolve(sentLast24h);
      case "failed":
        // The windowed query adds a `createdAt` bound; the lifetime total omits it.
        return Promise.resolve(where.createdAt ? recentFailed : failed);
      case "digest_pending":
        return Promise.resolve(digestPending);
      default:
        return Promise.resolve(0);
    }
  });
}

describe("evaluateEmailHealth", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.emailJob.count).mockReset();
    vi.mocked(mockPrisma.emailJob.findFirst).mockReset().mockResolvedValue(null);
    vi.mocked(getConfigValue).mockReset();
  });

  it("returns disabled when smtpEnabled config key is missing", async () => {
    vi.mocked(getConfigValue).mockRejectedValue(
      new NotFoundError("Configuration smtpEnabled not found"),
    );
    mockCounts({ pending: 1, sentLast24h: 5, failed: 2, digestPending: 0 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("disabled");
    expect(result.smtpConfigured).toBe(false);
    expect(result.queue).toEqual({ pending: 1, sentLast24h: 5, failed: 2, digestPending: 0 });
  });

  it("returns disabled when smtpEnabled is not 'true'", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("false");
    mockCounts({ pending: 0, sentLast24h: 0, failed: 0, digestPending: 0 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("disabled");
    expect(result.smtpConfigured).toBe(false);
  });

  it("returns ok when enabled and there are no failed jobs", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 3, sentLast24h: 10, failed: 0, digestPending: 2 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("ok");
    expect(result.smtpConfigured).toBe(true);
    expect(result.queue).toEqual({ pending: 3, sentLast24h: 10, failed: 0, digestPending: 2 });
  });

  it("returns ok when failures exist but none are recent (old dead-letter jobs)", async () => {
    // Lifetime total has 5 failures, but none within the 24h window and nothing
    // sent recently — a quiet but healthy instance must NOT report down/degraded.
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 0, sentLast24h: 0, failed: 5, failedRecent: 0, digestPending: 0 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("ok");
    // The lifetime `failed` counter is still surfaced for admin context.
    expect(result.queue.failed).toBe(5);
  });

  it("returns degraded when enabled with failed jobs but mail still going out", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 1, sentLast24h: 8, failed: 3, digestPending: 0 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("degraded");
    expect(result.smtpConfigured).toBe(true);
  });

  it("returns down when enabled with failed jobs and nothing sent in 24h", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 1, sentLast24h: 0, failed: 4, digestPending: 0 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("down");
    expect(result.smtpConfigured).toBe(true);
  });

  it("selects the most recent non-null lastError", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 0, sentLast24h: 1, failed: 1, digestPending: 0 });
    vi.mocked(mockPrisma.emailJob.findFirst).mockResolvedValue({
      lastError: "SMTP 535 auth failed",
    });

    const result = await evaluateEmailHealth();

    expect(result.lastError).toBe("SMTP 535 auth failed");
    // Scoped to recently-failed jobs only: a job that ultimately sent keeps a
    // stale lastError, and an old dead-letter job is not a current problem.
    expect(mockPrisma.emailJob.findFirst).toHaveBeenCalledWith({
      where: { status: "failed", lastError: { not: null }, createdAt: { gte: expect.any(Date) } },
      orderBy: { createdAt: "desc" },
      select: { lastError: true },
    });
  });

  it("returns null lastError when no job has an error", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 0, sentLast24h: 1, failed: 0, digestPending: 0 });
    vi.mocked(mockPrisma.emailJob.findFirst).mockResolvedValue(null);

    const result = await evaluateEmailHealth();

    expect(result.lastError).toBeNull();
  });
});
