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
 *
 * The stall signals are keyed off the extra `where` bounds: the stalled-pending
 * query adds `nextAttemptAt`, the stalled-processing query targets the
 * `processing` status. Both default to 0 so a test that does not opt into a
 * stall reports a draining queue.
 */
function mockCounts({
  pending,
  sentLast24h,
  failed,
  failedRecent,
  digestPending,
  stalledPending = 0,
  stalledProcessing = 0,
}: {
  pending: number;
  sentLast24h: number;
  failed: number;
  failedRecent?: number;
  digestPending: number;
  stalledPending?: number;
  stalledProcessing?: number;
}): void {
  const recentFailed = failedRecent ?? failed;
  mockPrisma.emailJob.count.mockImplementation((args: { where: Record<string, unknown> }) => {
    const where = args.where;
    switch (where.status) {
      case "pending":
        // The stall query adds a `nextAttemptAt` bound; the total backlog omits it.
        return Promise.resolve(where.nextAttemptAt ? stalledPending : pending);
      case "sent":
        return Promise.resolve(sentLast24h);
      case "failed":
        // The windowed query adds a `createdAt` bound; the lifetime total omits it.
        return Promise.resolve(where.createdAt ? recentFailed : failed);
      case "digest_pending":
        return Promise.resolve(digestPending);
      case "processing":
        return Promise.resolve(stalledProcessing);
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

  it("returns degraded when the queue is stalled with ready pending jobs (no failures)", async () => {
    // The worker is not draining: a job has been ready to send past the stall
    // window, yet there are no outright failures. The failure-based signals alone
    // would report ok — the stall detection must surface it.
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 7, sentLast24h: 4, failed: 0, digestPending: 0, stalledPending: 7 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("degraded");
  });

  it("returns degraded when a job is stuck in processing past the stall window", async () => {
    // A hung transport leaves a job locked in `processing`; the frozen worker
    // never reaches stuck-job recovery. No failures recorded yet.
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 1, sentLast24h: 0, failed: 0, digestPending: 0, stalledProcessing: 1 });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("degraded");
  });

  it("stays ok when pending jobs exist but none have aged past the stall window", async () => {
    // A healthy worker drains oldest-first, so a backlog with no over-aged ready
    // job is normal throughput, not a stall.
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({
      pending: 50,
      sentLast24h: 20,
      failed: 0,
      digestPending: 0,
      stalledPending: 0,
      stalledProcessing: 0,
    });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("ok");
  });

  it("keeps down precedence over a concurrent stall (failures + nothing sent)", async () => {
    // A stall must not downgrade a confirmed outage: recent failures with zero
    // throughput stay `down`, the most severe state.
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({
      pending: 3,
      sentLast24h: 0,
      failed: 2,
      digestPending: 0,
      stalledPending: 3,
    });

    const result = await evaluateEmailHealth();

    expect(result.status).toBe("down");
  });

  it("queries the stall signals with the correct status and age bounds", async () => {
    vi.mocked(getConfigValue).mockResolvedValue("true");
    mockCounts({ pending: 0, sentLast24h: 1, failed: 0, digestPending: 0 });

    await evaluateEmailHealth();

    expect(mockPrisma.emailJob.count).toHaveBeenCalledWith({
      where: { status: "pending", nextAttemptAt: { lte: expect.any(Date) } },
    });
    expect(mockPrisma.emailJob.count).toHaveBeenCalledWith({
      where: { status: "processing", lockedAt: { lte: expect.any(Date) } },
    });
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
