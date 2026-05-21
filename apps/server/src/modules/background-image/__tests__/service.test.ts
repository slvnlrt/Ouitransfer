/**
 * service.test.ts
 *
 * Unit tests for BackgroundImageService pure logic.
 *
 * The service imports storage.config.ts which transitively imports env.ts
 * (validated at module load time). We mock both storage.config.ts and the
 * repository (via prisma) to isolate the pure logic under test.
 */

import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

// ── Mock sharp — image processing library ──────────────────────────────────────
vi.mock("sharp", () => {
  const toBufferFn = vi.fn().mockResolvedValue(Buffer.from("processed"));
  const webpFn = vi.fn().mockReturnThis();
  const resizeFn = vi.fn().mockReturnThis();
  const metadataFn = vi.fn().mockResolvedValue({ width: 1920, height: 1080, format: "jpeg" });

  const sharpInstance = {
    metadata: metadataFn,
    resize: resizeFn,
    webp: webpFn,
    toBuffer: toBufferFn,
  };

  const sharpConstructor = vi.fn().mockReturnValue(sharpInstance);

  return { default: sharpConstructor };
});

// ── Mock @aws-sdk/s3-request-presigner ─────────────────────────────────────────
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://example.com/presigned-url"),
}));

// ── Mock logger — getLogger() is called in delete() when S3 fails ─────────────
vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  setLogger: vi.fn(),
}));

// ── Mock storage.config — prevents env.ts validation at module load time ───────
// Path is relative to THIS file: __tests__/ is 3 levels below src/config/
const _mockS3Send = vi.fn().mockResolvedValue({});

vi.mock("../../../config/storage.config.js", () => ({
  s3Client: { send: vi.fn().mockResolvedValue({}) },
  bucketName: "test-bucket",
  isExternalS3: false,
  isInternalStorage: false,
  rejectUnauthorized: true,
  storageConfig: {},
  createPublicS3Client: vi.fn().mockReturnValue(null),
  ensureBucket: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock Prisma — repository is instantiated in the service constructor ─────────
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    backgroundImage: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharpLib from "sharp";
import { s3Client } from "../../../config/storage.config.js";
import { prisma } from "../../../shared/prisma.js";
import { BackgroundImageService, MAX_RAW_SIZE } from "../service.js";

describe("BackgroundImageService", () => {
  // Instantiate after mocks are in place — no DB or S3 calls happen in constructor.
  const service = new BackgroundImageService();

  describe("deriveNameFromFilename", () => {
    it("strips extension and title-cases hyphenated filename", () => {
      expect(service.deriveNameFromFilename("mountain-sunset.jpg")).toBe("Mountain Sunset");
    });

    it("handles underscores as word separators", () => {
      expect(service.deriveNameFromFilename("city_skyline_night.png")).toBe("City Skyline Night");
    });

    it("handles filenames without extension", () => {
      expect(service.deriveNameFromFilename("ocean-waves")).toBe("Ocean Waves");
    });

    it("returns 'Untitled' for extension-only filename (empty stem)", () => {
      // ".jpg" → nameWithoutExt = "" → trim() → "" → falls back to "Untitled"
      expect(service.deriveNameFromFilename(".jpg")).toBe("Untitled");
    });

    it("handles a single word with extension", () => {
      expect(service.deriveNameFromFilename("landscape.webp")).toBe("Landscape");
    });

    it("handles mixed hyphens and underscores", () => {
      expect(service.deriveNameFromFilename("dark_blue-sky.jpg")).toBe("Dark Blue Sky");
    });

    it("handles webp extension", () => {
      expect(service.deriveNameFromFilename("sunset-view.webp")).toBe("Sunset View");
    });

    it("strips only the last extension segment (dots in stem preserved)", () => {
      // "my.photo.final.jpg" → strip ".jpg" → "my.photo.final"
      // \b\w capitalises first char after each word boundary (including after dots)
      expect(service.deriveNameFromFilename("my.photo.final.jpg")).toBe("My.Photo.Final");
    });

    it("returns 'Untitled' for empty string input", () => {
      expect(service.deriveNameFromFilename("")).toBe("Untitled");
    });
  });

  describe("upload", () => {
    // Access mocked s3Client.send
    const s3Send = (s3Client as unknown as { send: MockInstance }).send;
    const sharpMock = sharpLib as unknown as MockInstance;

    beforeEach(() => {
      vi.clearAllMocks();

      // Reset sharp mock to return a valid chainable instance by default
      const defaultInstance = {
        metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("processed")),
      };
      sharpMock.mockReturnValue(defaultInstance);

      // Reset s3 send mock
      s3Send.mockResolvedValue({});

      // Reset presigner mock
      (getSignedUrl as unknown as MockInstance).mockResolvedValue(
        "https://example.com/presigned-url",
      );

      // Reset prisma mocks
      (prisma.backgroundImage.aggregate as unknown as MockInstance).mockResolvedValue({
        _max: { sortOrder: -1 },
      });
      (prisma.backgroundImage.create as unknown as MockInstance).mockResolvedValue({
        id: "test-id",
        name: "Test Image",
        s3Key: "backgrounds/test-id.webp",
        thumbnailS3Key: "backgrounds/test-id_thumb.webp",
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    });

    it("rejects oversized buffer with ValidationError", async () => {
      const oversizedBuffer = Buffer.alloc(MAX_RAW_SIZE + 1);
      await expect(service.upload(oversizedBuffer, "photo.jpg")).rejects.toMatchObject({
        message: expect.stringContaining("10MB"),
      });
    });

    it("propagates sharp error when metadata() throws for an unrecognized buffer", async () => {
      const sharpError = new Error("Input buffer contains unsupported image");
      const invalidInstance = {
        metadata: vi.fn().mockRejectedValue(sharpError),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("data")),
      };
      sharpMock.mockReturnValue(invalidInstance);

      const buffer = Buffer.from("not-an-image");
      await expect(service.upload(buffer, "fake.bin")).rejects.toThrow(
        "Input buffer contains unsupported image",
      );
    });

    it("rejects image with no dimensions (metadata has no width/height)", async () => {
      const noSizeInstance = {
        metadata: vi.fn().mockResolvedValue({ format: "jpeg" }), // no width/height
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("data")),
      };
      sharpMock.mockReturnValue(noSizeInstance);

      const buffer = Buffer.from("partial-image");
      await expect(service.upload(buffer, "broken.jpg")).rejects.toMatchObject({
        message: "Invalid image file",
      });
    });

    it("calls s3Client.send twice with PutObjectCommand (full + thumb)", async () => {
      const buffer = Buffer.from("valid-image");
      await service.upload(buffer, "photo.jpg");

      expect(s3Send).toHaveBeenCalledTimes(2);

      // Both calls must use PutObjectCommand
      for (const call of s3Send.mock.calls) {
        expect(call[0]).toBeInstanceOf(PutObjectCommand);
      }
    });

    it("uploads full and thumbnail with correct S3 key patterns and ContentType", async () => {
      const buffer = Buffer.from("valid-image");
      await service.upload(buffer, "photo.jpg");

      const calls = s3Send.mock.calls.map((c) => c[0].input) as {
        Key: string;
        ContentType: string;
        Bucket: string;
      }[];

      const fullCall = calls.find((c) => !c.Key.includes("_thumb"));
      const thumbCall = calls.find((c) => c.Key.includes("_thumb"));

      expect(fullCall).toBeDefined();
      expect(thumbCall).toBeDefined();

      expect(fullCall?.Key).toMatch(/^backgrounds\/.+\.webp$/);
      expect(fullCall?.ContentType).toBe("image/webp");
      expect(fullCall?.Bucket).toBe("test-bucket");

      expect(thumbCall?.Key).toMatch(/^backgrounds\/.+_thumb\.webp$/);
      expect(thumbCall?.ContentType).toBe("image/webp");
      expect(thumbCall?.Bucket).toBe("test-bucket");
    });

    it("creates DB record with correct s3Key, thumbnailS3Key, and name fields", async () => {
      const buffer = Buffer.from("valid-image");
      await service.upload(buffer, "photo.jpg", "My Custom Name");

      expect(prisma.backgroundImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            s3Key: expect.stringMatching(/^backgrounds\/.+\.webp$/),
            thumbnailS3Key: expect.stringMatching(/^backgrounds\/.+_thumb\.webp$/),
            name: "My Custom Name",
          }),
        }),
      );
    });

    it("uses provided name over derived name", async () => {
      const buffer = Buffer.from("valid-image");
      await service.upload(buffer, "mountain-landscape.jpg", "My Custom Name");

      expect(prisma.backgroundImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "My Custom Name" }),
        }),
      );
    });

    it("derives name from filename when name is not provided", async () => {
      const buffer = Buffer.from("valid-image");
      await service.upload(buffer, "mountain-landscape.jpg");

      expect(prisma.backgroundImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Mountain Landscape" }),
        }),
      );
    });
  });

  describe("delete", () => {
    // Access mocked s3Client.send
    const s3Send = (s3Client as unknown as { send: MockInstance }).send;

    const mockImage = {
      id: "test-id",
      name: "Test Image",
      s3Key: "backgrounds/test-id.webp",
      thumbnailS3Key: "backgrounds/test-id_thumb.webp",
      sortOrder: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.backgroundImage.findUnique as unknown as MockInstance).mockResolvedValue(mockImage);
      (prisma.backgroundImage.delete as unknown as MockInstance).mockResolvedValue(mockImage);
      s3Send.mockResolvedValue({});
    });

    it("calls s3Client.send twice with DeleteObjectCommand (full + thumb)", async () => {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      await service.delete("test-id");

      expect(s3Send).toHaveBeenCalledTimes(2);
      for (const call of s3Send.mock.calls) {
        expect(call[0]).toBeInstanceOf(DeleteObjectCommand);
      }

      const keys = s3Send.mock.calls.map((c) => (c[0].input as { Key: string }).Key);
      expect(keys).toContain(mockImage.s3Key);
      expect(keys).toContain(mockImage.thumbnailS3Key);
    });

    it("deletes DB record even if both S3 deletes fail", async () => {
      s3Send.mockRejectedValue(new Error("S3 unavailable"));

      await service.delete("test-id");

      expect(prisma.backgroundImage.delete).toHaveBeenCalledWith({ where: { id: "test-id" } });
    });

    it("deletes DB record even if only one S3 delete fails", async () => {
      s3Send
        .mockResolvedValueOnce({}) // first call succeeds
        .mockRejectedValueOnce(new Error("S3 partial failure")); // second call fails

      await service.delete("test-id");

      expect(prisma.backgroundImage.delete).toHaveBeenCalledWith({ where: { id: "test-id" } });
    });

    it("throws NotFoundError when image does not exist", async () => {
      (prisma.backgroundImage.findUnique as unknown as MockInstance).mockResolvedValue(null);

      await expect(service.delete("nonexistent-id")).rejects.toMatchObject({
        message: "Background image not found",
      });
      expect(prisma.backgroundImage.delete).not.toHaveBeenCalled();
    });
  });
});
