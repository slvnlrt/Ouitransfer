import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const {
  mockGetConfigValue,
  mockPrisma,
  mockLogger,
  mockSmtpTransport,
  mockEmailQueueEvents,
  mockValidateAllI18nKeys,
} = vi.hoisted(() => ({
  mockGetConfigValue: vi.fn(),
  mockValidateAllI18nKeys: vi.fn().mockResolvedValue(undefined),
  mockPrisma: {
    emailJob: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
  mockSmtpTransport: {
    sendMail: vi.fn(),
  },
  mockEmailQueueEvents: {
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  },
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock("../transport.js", () => ({
  smtpTransport: mockSmtpTransport,
}));

vi.mock("../events.js", () => ({
  emailQueueEvents: mockEmailQueueEvents,
}));

vi.mock("../catalog.js", () => ({
  validateAllI18nKeys: mockValidateAllI18nKeys,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { EMAIL_LOGO_CID } from "../assets/logo.js";
import {
  getMaxRetries,
  initEmailQueueOnBoot,
  startEmailQueueScheduler,
  stopEmailQueueScheduler,
} from "../queue.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(
  overrides: Partial<{
    id: string;
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    listUnsubscribe: string | null;
    attempts: number;
    maxAttempts: number;
    priority: number;
  }> = {},
) {
  return {
    id: "job-1",
    to: "user@test.com",
    subject: "Test subject",
    htmlBody: "<p>Hello</p>",
    textBody: "Hello",
    listUnsubscribe: null,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    ...overrides,
  };
}

function setupDefaultMocks() {
  // Default config: 30s interval, 3 max retries, 30 days retention
  mockGetConfigValue.mockImplementation(async (key: string) => {
    switch (key) {
      case "emailQueueIntervalSeconds":
        return "30";
      case "emailQueueMaxRetries":
        return "3";
      case "emailJobRetentionDays":
        return "30";
      default:
        throw new Error(`Unknown config key: ${key}`);
    }
  });

  // No pending jobs by default
  mockPrisma.emailJob.findMany.mockResolvedValue([]);
  // Default: atomic lock succeeds (count: 1). Tests that need it to fail override this.
  mockPrisma.emailJob.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.emailJob.update.mockResolvedValue({});
  mockPrisma.emailJob.deleteMany.mockResolvedValue({ count: 0 });

  // SMTP send succeeds by default
  mockSmtpTransport.sendMail.mockResolvedValue(undefined);

  // emailQueueEvents.on/off are no-ops
  mockEmailQueueEvents.on.mockImplementation(() => mockEmailQueueEvents);
  mockEmailQueueEvents.off.mockImplementation(() => mockEmailQueueEvents);
  mockEmailQueueEvents.removeListener.mockImplementation(() => mockEmailQueueEvents);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EmailQueueScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    stopEmailQueueScheduler();
    vi.useRealTimers();
  });

  // ── processBatch() — job selection ──────────────────────────────────────

  describe("processBatch() — job selection", () => {
    it("picks up pending jobs where nextAttemptAt <= now, ordered by priority DESC, createdAt ASC", async () => {
      startEmailQueueScheduler();

      await vi.advanceTimersByTimeAsync(30_000 + 1);

      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "pending",
            nextAttemptAt: expect.objectContaining({ lte: expect.any(Date) }),
          }),
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          take: 10,
        }),
      );
    });

    it("handles batch of up to 10 jobs", async () => {
      startEmailQueueScheduler();

      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const findManyCall = mockPrisma.emailJob.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(10);
    });
  });

  // ── processBatch() — job lifecycle ──────────────────────────────────────

  describe("processBatch() — job lifecycle", () => {
    it("atomically locks each job (updateMany with status guard) before sending", async () => {
      const job = makeJob();
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockPrisma.emailJob.updateMany.mockResolvedValue({ count: 1 });

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      expect(mockPrisma.emailJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-1", status: "pending" },
          data: expect.objectContaining({
            status: "processing",
            lockedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("skips job when atomic lock fails (count !== 1)", async () => {
      const job = makeJob();
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      // Lock fails — job was already claimed
      mockPrisma.emailJob.updateMany.mockResolvedValue({ count: 0 });

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      // Should NOT attempt to send the email
      expect(mockSmtpTransport.sendMail).not.toHaveBeenCalled();
    });

    it("marks job 'sent' with sentAt on successful send", async () => {
      const job = makeJob();
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockResolvedValue(undefined);

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      // Check that update was called with 'sent' status at some point
      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const sentCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "sent",
      );
      expect(sentCall).toBeDefined();
      expect((sentCall![0] as { data: { sentAt?: Date } }).data.sentAt).toBeInstanceOf(Date);
    });

    it("passes listUnsubscribeHeader to sendMail when listUnsubscribe is set", async () => {
      const job = makeJob({ listUnsubscribe: "<https://example.com/unsubscribe>" });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      expect(mockSmtpTransport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: job.to,
          subject: job.subject,
          html: job.htmlBody,
          text: job.textBody,
          listUnsubscribeHeader: "<https://example.com/unsubscribe>",
        }),
      );
    });

    it("sends without listUnsubscribeHeader when listUnsubscribe is null", async () => {
      const job = makeJob({ listUnsubscribe: null });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const sendMailCall = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendMailCall.listUnsubscribeHeader).toBeUndefined();
    });

    it("attaches the inline brand logo when the HTML references its CID", async () => {
      const job = makeJob({ htmlBody: `<img src="cid:${EMAIL_LOGO_CID}"><p>Hi</p>` });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const sendMailCall = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendMailCall.attachments).toHaveLength(1);
      expect(sendMailCall.attachments[0]).toMatchObject({
        cid: EMAIL_LOGO_CID,
        contentDisposition: "inline",
        filename: "logo.png",
      });
      expect(Buffer.isBuffer(sendMailCall.attachments[0].content)).toBe(true);
    });

    it("does not attach the logo when the HTML does not reference its CID", async () => {
      const job = makeJob({ htmlBody: "<p>No logo here</p>" });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const sendMailCall = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendMailCall.attachments).toBeUndefined();
    });
  });

  // ── processBatch() — retry / backoff ────────────────────────────────────

  describe("processBatch() — retry / backoff", () => {
    it("on SMTP failure: increments attempts, sets nextAttemptAt with exponential backoff", async () => {
      const job = makeJob({ attempts: 0, maxAttempts: 3 });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockRejectedValue(new Error("SMTP connection failed"));

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const failCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "pending",
      );
      expect(failCall).toBeDefined();
      const data = (
        failCall![0] as { data: { attempts?: number; nextAttemptAt?: Date; lastError?: string } }
      ).data;
      expect(data.attempts).toBe(1);
      expect(data.nextAttemptAt).toBeInstanceOf(Date);
      expect(data.lastError).toContain("SMTP connection failed");
    });

    it("backoff delay attempt 1: ~1min (60s)", async () => {
      // attempts=0 → newAttempts=1 → BACKOFF_SECONDS[0]=60s
      // maxAttempts=4 so it retries (newAttempts=1 < 4)
      const job = makeJob({ attempts: 0, maxAttempts: 4 });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockRejectedValue(new Error("fail"));

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      // Capture now AFTER timer advancement so the baseline matches queue.ts's Date.now()
      const now = Date.now();

      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const retryCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "pending",
      );
      expect(retryCall).toBeDefined();
      const nextAttempt = (retryCall![0] as { data: { nextAttemptAt?: Date } }).data.nextAttemptAt!;
      // nextAttemptAt was set using Date.now() + 60000 inside the scheduler tick,
      // so it should be within a few ms of (now + 60000)
      const diffFromNow = nextAttempt.getTime() - now;
      expect(diffFromNow).toBeGreaterThanOrEqual(59_000);
      expect(diffFromNow).toBeLessThanOrEqual(61_000);
    });

    it("backoff delay attempt 2: ~2min (120s)", async () => {
      // attempts=1 → newAttempts=2 → min(3600, 60 * 2^1) = 120s
      // maxAttempts=4 so it retries (newAttempts=2 < 4)
      const job = makeJob({ attempts: 1, maxAttempts: 4 });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockRejectedValue(new Error("fail"));

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      const now = Date.now();

      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const retryCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "pending",
      );
      expect(retryCall).toBeDefined();
      const nextAttempt = (retryCall![0] as { data: { nextAttemptAt?: Date } }).data.nextAttemptAt!;
      const diffFromNow = nextAttempt.getTime() - now;
      expect(diffFromNow).toBeGreaterThanOrEqual(119_000);
      expect(diffFromNow).toBeLessThanOrEqual(121_000);
    });

    it("backoff delay attempt 3: ~4min (240s)", async () => {
      // attempts=2 → newAttempts=3 → min(3600, 60 * 2^2) = 240s
      // maxAttempts=4 so it retries (newAttempts=3 < 4)
      const job = makeJob({ attempts: 2, maxAttempts: 4 });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockRejectedValue(new Error("fail"));

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      const now = Date.now();

      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const retryCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "pending",
      );
      expect(retryCall).toBeDefined();
      const nextAttempt = (retryCall![0] as { data: { nextAttemptAt?: Date } }).data.nextAttemptAt!;
      const diffFromNow = nextAttempt.getTime() - now;
      expect(diffFromNow).toBeGreaterThanOrEqual(239_000);
      expect(diffFromNow).toBeLessThanOrEqual(241_000);
    });

    it("marks job 'failed' permanently when attempts >= maxAttempts", async () => {
      // attempts will become 3 which equals maxAttempts=3
      const job = makeJob({ attempts: 2, maxAttempts: 3 });
      mockPrisma.emailJob.findMany.mockResolvedValue([job]);
      mockSmtpTransport.sendMail.mockRejectedValue(new Error("final failure"));

      startEmailQueueScheduler();
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      const updateCalls = mockPrisma.emailJob.update.mock.calls;
      const failedCall = updateCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.update>[0][]) =>
          (call[0] as { data: { status?: string } }).data?.status === "failed",
      );
      expect(failedCall).toBeDefined();
      expect((failedCall![0] as { data: { attempts?: number } }).data.attempts).toBe(3);
    });
  });

  // ── recoverStuckJobs() ────────────────────────────────────────────────────

  describe("recoverStuckJobs()", () => {
    it("recovers stuck 'processing' jobs: increments attempts and applies backoff", async () => {
      mockPrisma.emailJob.findMany.mockResolvedValueOnce([
        { id: "stuck-1", attempts: 0, maxAttempts: 3 },
      ]);

      await initEmailQueueOnBoot();

      // Should call findMany to find stuck jobs
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "processing",
            lockedAt: expect.objectContaining({ lte: expect.any(Date) }),
          }),
        }),
      );

      // Should update the stuck job with incremented attempts and backoff
      expect(mockPrisma.emailJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-1" },
          data: expect.objectContaining({
            status: "pending",
            attempts: 1,
            lastError: "Recovered from stuck processing state",
            lockedAt: null,
            nextAttemptAt: expect.any(Date),
          }),
        }),
      );
    });

    it("marks stuck job as failed when max attempts exhausted", async () => {
      mockPrisma.emailJob.findMany.mockResolvedValueOnce([
        { id: "stuck-2", attempts: 2, maxAttempts: 3 },
      ]);

      await initEmailQueueOnBoot();

      expect(mockPrisma.emailJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-2" },
          data: expect.objectContaining({
            status: "failed",
            attempts: 3,
            lastError: "Recovered from stuck processing state (max attempts exhausted)",
            lockedAt: null,
          }),
        }),
      );
    });
  });

  // ── cleanupSentJobs() ────────────────────────────────────────────────────

  describe("cleanupSentJobs()", () => {
    it("deletes 'sent' jobs older than emailJobRetentionDays", async () => {
      // cleanupSentJobs runs every CLEANUP_EVERY_N_TICKS = 120 ticks
      // We need to advance 120 ticks * 30s = 3600s + initial tick
      startEmailQueueScheduler();

      // Each tick is 30s, cleanup runs every 120 ticks
      await vi.advanceTimersByTimeAsync(120 * 30_000 + 1);

      const deleteCalls = mockPrisma.emailJob.deleteMany.mock.calls;
      const sentCleanupCall = deleteCalls.find(
        (call: Parameters<typeof mockPrisma.emailJob.deleteMany>[0][]) =>
          (call[0] as { where?: { status?: string } }).where?.status === "sent",
      );
      expect(sentCleanupCall).toBeDefined();
    });
  });

  // ── wake event ────────────────────────────────────────────────────────────

  describe("wake event", () => {
    it("registers wake listener on start", () => {
      startEmailQueueScheduler();

      expect(mockEmailQueueEvents.on).toHaveBeenCalledWith("wake", expect.any(Function));
    });

    it("removes wake listener on stop (no listener leak)", () => {
      startEmailQueueScheduler();
      stopEmailQueueScheduler();

      // Either off or removeListener should be called with "wake"
      const offCalls = mockEmailQueueEvents.off.mock.calls;
      const removeListenerCalls = mockEmailQueueEvents.removeListener.mock.calls;
      const allCalls = [...offCalls, ...removeListenerCalls];
      const wakeRemoved = allCalls.some((call: unknown[]) => call[0] === "wake");
      expect(wakeRemoved).toBe(true);
    });
  });

  // ── start() / stop() ─────────────────────────────────────────────────────

  describe("start() / stop()", () => {
    it("start() begins polling at configured interval", async () => {
      startEmailQueueScheduler();

      // Should not poll immediately
      expect(mockPrisma.emailJob.findMany).not.toHaveBeenCalled();

      // After 30s, should poll
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledTimes(1);
    });

    it("stop() prevents further polling", async () => {
      startEmailQueueScheduler();

      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledTimes(1);

      stopEmailQueueScheduler();

      // Advance another 30s — should not poll again
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledTimes(1);
    });

    it("stop() is idempotent — safe to call when not running", () => {
      expect(() => stopEmailQueueScheduler()).not.toThrow();
    });

    it("chains next execution after tick completes", async () => {
      startEmailQueueScheduler();

      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledTimes(2);
    });
  });

  // ── initEmailQueueOnBoot() ────────────────────────────────────────────────

  describe("initEmailQueueOnBoot()", () => {
    it("runs recoverStuckJobs immediately on boot", async () => {
      await initEmailQueueOnBoot();

      // findMany for stuck jobs recovery should be called immediately
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "processing",
          }),
        }),
      );
    });

    it("starts the scheduler after boot", async () => {
      await initEmailQueueOnBoot();

      // After interval, should start polling
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      expect(mockPrisma.emailJob.findMany).toHaveBeenCalled();
    });

    it("does not throw when recoverStuckJobs fails", async () => {
      // recoverStuckJobs now uses findMany to find stuck jobs — fail this call
      mockPrisma.emailJob.findMany.mockRejectedValueOnce(new Error("DB unavailable"));

      await expect(initEmailQueueOnBoot()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("disables email subsystem gracefully when i18n validation fails", async () => {
      mockValidateAllI18nKeys.mockRejectedValue(
        new Error("Missing i18n key: shareExpiring.subject"),
      );

      await expect(initEmailQueueOnBoot()).resolves.not.toThrow();
      expect(mockLogger.fatal).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("i18n validation failed"),
      );
    });
  });

  // ── getMaxRetries() ──────────────────────────────────────────────────────

  describe("getMaxRetries()", () => {
    it("returns 0 when config is '0' (fail-fast, no retries) (I-6)", async () => {
      mockGetConfigValue.mockImplementation(async (key: string) => {
        if (key === "emailQueueMaxRetries") return "0";
        throw new Error(`Unknown config key: ${key}`);
      });

      const result = await getMaxRetries();
      expect(result).toBe(0);
    });

    it("returns 3 for negative values", async () => {
      mockGetConfigValue.mockImplementation(async (key: string) => {
        if (key === "emailQueueMaxRetries") return "-1";
        throw new Error(`Unknown config key: ${key}`);
      });

      const result = await getMaxRetries();
      expect(result).toBe(3);
    });

    it("returns 3 when config key is missing", async () => {
      mockGetConfigValue.mockRejectedValue(new Error("Config not found"));

      const result = await getMaxRetries();
      expect(result).toBe(3);
    });

    it("returns parsed value for valid positive integer", async () => {
      mockGetConfigValue.mockImplementation(async (key: string) => {
        if (key === "emailQueueMaxRetries") return "5";
        throw new Error(`Unknown config key: ${key}`);
      });

      const result = await getMaxRetries();
      expect(result).toBe(5);
    });
  });

  // ── wake event during processing (I-2) ──────────────────────────────────

  describe("wake event during processing (I-2)", () => {
    it("wakePending flag ensures wake events are not lost during batch processing", async () => {
      // Setup: one pending job that will take some processing time
      const job = makeJob();
      let findManyCallCount = 0;
      mockPrisma.emailJob.findMany.mockImplementation(async () => {
        findManyCallCount++;
        // First call returns a job; second call (from wake re-tick) returns empty
        return findManyCallCount === 1 ? [job] : [];
      });

      startEmailQueueScheduler();

      // Capture the registered wake handler
      const onCall = mockEmailQueueEvents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "wake",
      );
      expect(onCall).toBeDefined();
      const wakeHandler = onCall![1] as () => void;

      // Trigger the first tick (30s interval)
      await vi.advanceTimersByTimeAsync(30_000 + 1);

      // At this point, the first batch was processed. Now simulate a wake
      // event that would have fired during processing. Since the test uses
      // fake timers and everything is sequential, we trigger wake and then
      // advance to let the immediate re-tick fire.
      wakeHandler();

      // The wake handler should have scheduled an immediate tick (setTimeout 0).
      // Advance timers to let it fire.
      await vi.advanceTimersByTimeAsync(1);

      // The wake should have triggered a re-tick (findMany called again)
      expect(findManyCallCount).toBeGreaterThanOrEqual(2);
    });
  });
});
