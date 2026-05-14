import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for ensureBucket() in storage.config.ts.
 *
 * Strategy: vi.doMock + vi.resetModules + dynamic import per test so each
 * test gets its own fresh module with a controlled S3Client mock and
 * a controlled getLogger() mock.
 *
 * S3Client MUST be mocked as a class (not an arrow function) because
 * storage.config.ts uses `new S3Client(...)`.
 */

// Minimum required env vars for env.ts to parse without throwing ZodError
const BASE_ENV = {
  JWT_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  COOKIE_SECRET: "c".repeat(32),
};

// S3 env vars that make hasValidConfig=true in storage.config.ts
const S3_ENV = {
  S3_ENDPOINT: "localhost",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_BUCKET_NAME: "test-bucket",
  S3_REGION: "us-east-1",
};

/** Build a vi.doMock factory for @aws-sdk/client-s3 that replaces S3Client
 *  with a class whose `send` method delegates to `mockSend`. */
function mockS3ClientModule(mockSend: ReturnType<typeof vi.fn>) {
  vi.doMock("@aws-sdk/client-s3", async () => {
    const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
    // Must be a class (constructor), not an arrow function.
    return {
      ...actual,
      S3Client: class MockS3Client {
        // biome-ignore lint/suspicious/noExplicitAny: test helper
        send(...args: any[]) {
          return (mockSend as (...a: unknown[]) => unknown)(...args);
        }
      },
    };
  });
}

describe("ensureBucket — actual function from storage.config.ts", () => {
  let mockLoggerInfo: ReturnType<typeof vi.fn>;
  let mockLoggerError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLoggerInfo = vi.fn();
    mockLoggerError = vi.fn();
    // Mock getLogger() so ensureBucket() can use structured logging without
    // requiring a real Fastify app instance.
    vi.doMock("../../utils/logger.js", () => ({
      getLogger: () => ({
        info: mockLoggerInfo,
        error: mockLoggerError,
        warn: vi.fn(),
      }),
      setLogger: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ─── Not configured ──────────────────────────────────────────────────────────

  describe("when S3 is not configured (missing env vars)", () => {
    beforeEach(() => {
      for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
      // Empty S3 credentials → hasValidConfig=false → s3Client=null
      vi.stubEnv("S3_ENDPOINT", "");
      vi.stubEnv("S3_ACCESS_KEY", "");
      vi.stubEnv("S3_SECRET_KEY", "");
      vi.stubEnv("S3_BUCKET_NAME", "");
    });

    it("logs and returns early when s3Client is null", async () => {
      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "[STORAGE] S3 not configured — skipping bucket check",
      );
    });
  });

  // ─── Configured ──────────────────────────────────────────────────────────────

  describe("when S3 is configured", () => {
    beforeEach(() => {
      for (const [k, v] of Object.entries({ ...BASE_ENV, ...S3_ENV })) vi.stubEnv(k, v);
    });

    it("logs bucket exists when HeadBucket succeeds", async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { bucket: "test-bucket" },
        "[STORAGE] Bucket exists",
      );
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify the correct command type was sent
      const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
    });

    it("creates bucket when HeadBucket returns NotFound", async () => {
      const notFoundError = Object.assign(new Error("Not Found"), { name: "NotFound" });
      const mockSend = vi.fn().mockRejectedValueOnce(notFoundError).mockResolvedValueOnce({});
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { bucket: "test-bucket" },
        "[STORAGE] Creating bucket",
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { bucket: "test-bucket" },
        "[STORAGE] Bucket created",
      );
      expect(mockSend).toHaveBeenCalledTimes(2);

      const { HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
      expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadBucketCommand));
      expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(CreateBucketCommand));
    });

    it("creates bucket when HeadBucket returns NoSuchBucket", async () => {
      const noSuchBucketError = Object.assign(new Error("No Such Bucket"), {
        name: "NoSuchBucket",
      });
      const mockSend = vi.fn().mockRejectedValueOnce(noSuchBucketError).mockResolvedValueOnce({});
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { bucket: "test-bucket" },
        "[STORAGE] Creating bucket",
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { bucket: "test-bucket" },
        "[STORAGE] Bucket created",
      );
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("rethrows non-NotFound errors from HeadBucket", async () => {
      const accessDeniedError = Object.assign(new Error("Access Denied"), {
        name: "AccessDenied",
      });
      const mockSend = vi.fn().mockRejectedValueOnce(accessDeniedError);
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await expect(ensureBucket()).rejects.toThrow("Access Denied");
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "test-bucket" }),
        "[STORAGE] Bucket check failed",
      );
    });

    it("throws a descriptive error when CreateBucket fails after NotFound", async () => {
      const notFoundError = Object.assign(new Error("Not Found"), { name: "NotFound" });
      const createError = Object.assign(new Error("Access Denied on create"), {
        name: "AccessDenied",
      });
      // HeadBucket → NotFound, CreateBucket → AccessDenied
      const mockSend = vi
        .fn()
        .mockRejectedValueOnce(notFoundError)
        .mockRejectedValueOnce(createError);
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await expect(ensureBucket()).rejects.toThrow(
        '[STORAGE] Failed to create bucket "test-bucket": Access Denied on create',
      );
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "test-bucket", err: createError }),
        "[STORAGE] Bucket creation failed",
      );
    });
  });
});
