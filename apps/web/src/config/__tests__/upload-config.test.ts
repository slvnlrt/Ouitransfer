import { describe, expect, it } from "vitest";

import {
  getMultipartChunkSize,
  MAX_MULTIPART_PARTS,
  MIN_MULTIPART_CHUNK_SIZE,
} from "../upload-config";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function partCount(fileSize: number): number {
  return Math.ceil(fileSize / getMultipartChunkSize({ size: fileSize }));
}

describe("multipart chunk planning", () => {
  it("uses 64 MiB parts for files above 10 GiB", () => {
    const fileSize = 10 * GIB + 1;

    expect(getMultipartChunkSize({ size: fileSize })).toBe(64 * MIB);
    expect(partCount(fileSize)).toBe(161);
  });

  it("does not reproduce the old 10,001-part boundary", () => {
    const fileSize = 5 * MIB * 10_000 + 1;

    expect(partCount(fileSize)).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);
  });

  it("increases the chunk size immediately above the 64 MiB transition", () => {
    const transition = MIN_MULTIPART_CHUNK_SIZE * MAX_MULTIPART_PARTS;

    expect(getMultipartChunkSize({ size: transition })).toBe(MIN_MULTIPART_CHUNK_SIZE);
    expect(getMultipartChunkSize({ size: transition + 1 })).toBe(MIN_MULTIPART_CHUNK_SIZE + 1);
    expect(partCount(transition + 1)).toBe(MAX_MULTIPART_PARTS);
  });

  it("keeps a 50 TB object within the multipart protocol boundaries", () => {
    const fileSize = 50 * 1000 ** 4;
    const chunkSize = getMultipartChunkSize({ size: fileSize });

    expect(Math.ceil(fileSize / chunkSize)).toBeLessThanOrEqual(MAX_MULTIPART_PARTS);
    expect(chunkSize).toBeLessThanOrEqual(5 * GIB);
  });
});
