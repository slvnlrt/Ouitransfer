import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("../../config/storage.config.js", () => ({
  bucketName: "test-bucket",
  s3Client: { send: mockSend },
  createPublicS3Client: vi.fn(() => ({ send: mockSend })),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { S3StorageProvider } from "../s3-storage.provider.js";

const provider = new S3StorageProvider();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── listObjects ─────────────────────────────────────────────────────────────────

describe("S3StorageProvider.listObjects", () => {
  it("concatenates a truncated page with the final page (pagination)", async () => {
    const d1 = new Date("2026-06-01T00:00:00.000Z");
    const d2 = new Date("2026-06-02T00:00:00.000Z");
    const d3 = new Date("2026-06-03T00:00:00.000Z");

    mockSend
      // First page: truncated, returns a continuation token.
      .mockResolvedValueOnce({
        Contents: [
          { Key: "a.bin", Size: 10, LastModified: d1 },
          { Key: "b.bin", Size: 20, LastModified: d2 },
        ],
        IsTruncated: true,
        NextContinuationToken: "token-1",
      })
      // Second (final) page.
      .mockResolvedValueOnce({
        Contents: [{ Key: "c.bin", Size: 30, LastModified: d3 }],
        IsTruncated: false,
      });

    const result = await provider.listObjects();

    expect(mockSend).toHaveBeenCalledTimes(2);
    // The pages are concatenated in order.
    expect(result).toEqual([
      { key: "a.bin", size: 10, lastModified: d1 },
      { key: "b.bin", size: 20, lastModified: d2 },
      { key: "c.bin", size: 30, lastModified: d3 },
    ]);

    // First call carries no ContinuationToken; the second carries the returned one.
    const firstCmd = mockSend.mock.calls[0][0] as ListObjectsV2Command;
    const secondCmd = mockSend.mock.calls[1][0] as ListObjectsV2Command;
    expect(firstCmd).toBeInstanceOf(ListObjectsV2Command);
    expect(firstCmd.input.Bucket).toBe("test-bucket");
    expect(firstCmd.input.ContinuationToken).toBeUndefined();
    expect(secondCmd.input.ContinuationToken).toBe("token-1");
  });

  it("returns an empty array for an empty bucket (no Contents)", async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });

    const result = await provider.listObjects();

    expect(result).toEqual([]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("forwards the prefix and defaults missing Size/LastModified", async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: "prefixed/x.bin" }], // no Size, no LastModified
      IsTruncated: false,
    });

    const result = await provider.listObjects("prefixed/");

    const cmd = mockSend.mock.calls[0][0] as ListObjectsV2Command;
    expect(cmd.input.Prefix).toBe("prefixed/");
    expect(result).toEqual([{ key: "prefixed/x.bin", size: 0, lastModified: new Date(0) }]);
  });

  it("skips entries without a Key", async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Size: 5, LastModified: new Date() },
        { Key: "real.bin", Size: 1 },
      ],
      IsTruncated: false,
    });

    const result = await provider.listObjects();

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("real.bin");
  });
});
