import { describe, expect, it, vi } from "vitest";

const { storageEnv } = vi.hoisted(() => ({
  storageEnv: {
    S3_ENDPOINT: "storage",
    S3_PORT: "9000",
    S3_USE_SSL: "false",
    S3_ACCESS_KEY: "test-access-key",
    S3_SECRET_KEY: "test-secret-key",
    S3_REGION: "auto",
    S3_BUCKET_NAME: "test-bucket",
    S3_FORCE_PATH_STYLE: "true",
    S3_REJECT_UNAUTHORIZED: "true",
    ENABLE_S3: "false",
    STORAGE_URL: "https://storage.example.com",
    S3_ALLOW_PRIVATE_ENDPOINT: "false",
    STORAGE_ALLOWED_HOSTS: "",
  },
}));

vi.mock("../../env.js", () => ({ env: storageEnv }));

import { S3StorageProvider } from "../s3-storage.provider.js";

const provider = new S3StorageProvider();

function expectNoAutomaticChecksum(url: string): void {
  const params = new URL(url).searchParams;
  const checksumParams = [...params.keys()].filter((name) => name.startsWith("x-amz-checksum-"));
  const signedHeaders = params.get("X-Amz-SignedHeaders")?.split(";") ?? [];

  expect(checksumParams).toEqual([]);
  expect(params.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  expect(signedHeaders.some((name) => name.includes("checksum"))).toBe(false);
}

describe("S3StorageProvider presigned browser uploads", () => {
  it("does not attach an empty CRC32 checksum to a simple PUT URL", async () => {
    const url = await provider.getPresignedPutUrl("user/file.bin", 3600);

    expectNoAutomaticChecksum(url);
  });

  it("does not attach an empty CRC32 checksum to an UploadPart URL", async () => {
    const url = await provider.getPresignedPartUrl("user/large.bin", "upload-id", 1, 3600);

    expectNoAutomaticChecksum(url);
  });
});
