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
      // Pin internal storage explicitly. `isExternalS3`/`isInternalStorage` are read from
      // `env.ENABLE_S3` at module-import time, and these tests exercise the internal-storage
      // lifecycle path. Without an explicit baseline they depend on ENABLE_S3 being absent — but a
      // stray "true" (e.g. from the external-S3 test in this file leaking through env-restore
      // timing, or any future test) flips them to the external path and they fail with the bucket
      // lifecycle never applied. The external-S3 test overrides this to "true" in its own body.
      vi.stubEnv("ENABLE_S3", "false");
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
      // Head + lifecycle PUT (internal storage backstop).
      expect(mockSend).toHaveBeenCalledTimes(2);

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
      // Head (NotFound) → Create → lifecycle PUT (internal storage backstop).
      expect(mockSend).toHaveBeenCalledTimes(3);

      const { HeadBucketCommand, CreateBucketCommand, PutBucketLifecycleConfigurationCommand } =
        await import("@aws-sdk/client-s3");
      expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadBucketCommand));
      expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(CreateBucketCommand));
      expect(mockSend).toHaveBeenNthCalledWith(
        3,
        expect.any(PutBucketLifecycleConfigurationCommand),
      );
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
      // Head (NoSuchBucket) → Create → lifecycle PUT (internal storage backstop).
      expect(mockSend).toHaveBeenCalledTimes(3);
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

    it("applies the AbortIncompleteMultipartUpload lifecycle rule for INTERNAL storage", async () => {
      // ENABLE_S3 is unset in S3_ENV → internal storage. HeadBucket succeeds,
      // then the lifecycle rule is applied.
      const mockSend = vi.fn().mockResolvedValue({});
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      const { HeadBucketCommand, PutBucketLifecycleConfigurationCommand } = await import(
        "@aws-sdk/client-s3"
      );
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadBucketCommand));
      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.any(PutBucketLifecycleConfigurationCommand),
      );

      const lifecycleCmd = mockSend.mock.calls[1][0] as InstanceType<
        typeof PutBucketLifecycleConfigurationCommand
      >;
      const rule = lifecycleCmd.input.LifecycleConfiguration?.Rules?.[0];
      expect(rule?.Status).toBe("Enabled");
      expect(rule?.AbortIncompleteMultipartUpload?.DaysAfterInitiation).toBe(7);
    });

    it("does NOT apply the lifecycle rule for EXTERNAL S3 (never mutates an admin bucket)", async () => {
      vi.stubEnv("ENABLE_S3", "true"); // external S3
      const mockSend = vi.fn().mockResolvedValue({});
      mockS3ClientModule(mockSend);

      const { ensureBucket } = await import("../../config/storage.config.js");

      await ensureBucket();

      const { PutBucketLifecycleConfigurationCommand } = await import("@aws-sdk/client-s3");
      // Only HeadBucket — no lifecycle command.
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalledWith(expect.any(PutBucketLifecycleConfigurationCommand));
    });

    it("does not crash boot when the lifecycle rule is rejected (best-effort)", async () => {
      // HeadBucket succeeds; lifecycle PUT is rejected (backend without support).
      const lifecycleError = Object.assign(new Error("Not Implemented"), {
        name: "NotImplemented",
      });
      const mockSend = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(lifecycleError);
      mockS3ClientModule(mockSend);

      const mockLoggerWarn = vi.fn();
      vi.doMock("../../utils/logger.js", () => ({
        getLogger: () => ({ info: mockLoggerInfo, error: mockLoggerError, warn: mockLoggerWarn }),
        setLogger: vi.fn(),
      }));

      const { ensureBucket } = await import("../../config/storage.config.js");

      // Must resolve (not throw) despite the lifecycle failure.
      await expect(ensureBucket()).resolves.toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "test-bucket", err: lifecycleError }),
        expect.stringContaining("Could not apply multipart-upload lifecycle rule"),
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
