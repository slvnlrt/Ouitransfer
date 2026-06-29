/**
 * download-url-cache — intent-aware caching (B-34 / C-1 guard).
 *
 * A presigned URL is identical for a preview and a download of the same file, but generating it has a
 * server-side tracking SIDE EFFECT (preview → "preview" visit; download → "download" + recipient stats).
 * The cache must therefore key on `intent` so a real download after a preview still hits the server and
 * is recorded as a download — never served the preview's cached URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/http/endpoints", () => ({
  getDownloadUrl: vi.fn(),
}));
vi.mock("@/http/endpoints/reverse-shares", () => ({
  downloadReverseShareFile: vi.fn(),
}));

import { getDownloadUrl } from "@/http/endpoints";
import { getCachedDownloadUrl } from "@/lib/download-url-cache";

const mockGetDownloadUrl = vi.mocked(getDownloadUrl);

beforeEach(() => {
  vi.clearAllMocks();
  // biome-ignore lint/suspicious/noExplicitAny: minimal axios-response stub for the test
  mockGetDownloadUrl.mockResolvedValue({ data: { url: "https://s3/u", expiresIn: 3600 } } as any);
});

describe("getCachedDownloadUrl — intent-aware cache key", () => {
  it("a real download after a preview of the same file still hits the server (C-1)", async () => {
    const obj = "c1-obj";
    const shareId = "c1-share";

    await getCachedDownloadUrl(obj, undefined, shareId, "preview");
    await getCachedDownloadUrl(obj, undefined, shareId, "download");

    // Two distinct cache keys (preview vs download) → two requests, each with its own intent.
    expect(mockGetDownloadUrl).toHaveBeenCalledTimes(2);
    expect(mockGetDownloadUrl).toHaveBeenNthCalledWith(1, obj, undefined, "preview");
    expect(mockGetDownloadUrl).toHaveBeenNthCalledWith(2, obj, undefined, "download");
  });

  it("re-previewing the same file within the cache window does not re-request", async () => {
    const obj = "reopen-obj";
    await getCachedDownloadUrl(obj, undefined, "s", "preview");
    await getCachedDownloadUrl(obj, undefined, "s", "preview");
    expect(mockGetDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("omitted intent is treated as 'download' (same key as an explicit download)", async () => {
    const obj = "default-obj";
    await getCachedDownloadUrl(obj, undefined, "s"); // default download
    await getCachedDownloadUrl(obj, undefined, "s", "download"); // explicit download
    // Same logical request → one server call (no wasteful double-presign).
    expect(mockGetDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockGetDownloadUrl).toHaveBeenNthCalledWith(1, obj, undefined, "download");
  });
});
