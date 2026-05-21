/**
 * service.test.ts
 *
 * Unit tests for BackgroundImageService pure logic.
 *
 * The service imports storage.config.ts which transitively imports env.ts
 * (validated at module load time). We mock both storage.config.ts and the
 * repository (via prisma) to isolate the pure logic under test.
 */

import { describe, expect, it, vi } from "vitest";

// ── Mock storage.config — prevents env.ts validation at module load time ───────
// Path is relative to THIS file: __tests__/ is 3 levels below src/config/
vi.mock("../../../config/storage.config.js", () => ({
  s3Client: null,
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

import { BackgroundImageService } from "../service.js";

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
});
