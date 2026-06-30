/**
 * @vitest-environment jsdom
 *
 * Wiring test for use-file-preview.ts — focused on the B-34 intent plumbing.
 *
 * Verifies that opening the preview requests the presigned URL with intent
 * "preview" (so the server records a per-file ShareVisit "preview", not a
 * download), and that it forwards the shareId so the preview cache is scoped
 * per share (consistent with the download path; shareId is cache-scope only and
 * never sent to the server).
 *
 * It also verifies the explicit download path requests the URL with the default
 * (download) intent — never "preview" — and forwards the shareId for cache scoping.
 *
 * The download-url cache module is mocked, so no real fetch runs — the test
 * asserts only on the arguments the hook passes to the cache. The anchor click
 * in handleDownload is stubbed to avoid a jsdom navigation attempt.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCachedDownloadUrl, mockGetCachedReverseShareDownloadUrl } = vi.hoisted(() => ({
  mockGetCachedDownloadUrl: vi.fn(),
  mockGetCachedReverseShareDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/download-url-cache", () => ({
  getCachedDownloadUrl: mockGetCachedDownloadUrl,
  getCachedReverseShareDownloadUrl: mockGetCachedReverseShareDownloadUrl,
}));

// next-intl's real useTranslations returns a STABLE `t` across renders. The hook
// lists `t` in loadPreview's deps, so a fresh function each render would change
// loadPreview's identity, re-fire the load effect, setState, and loop forever.
// Return a single stable function to mirror the real behaviour.
const stableT = (key: string) => key;
vi.mock("next-intl", () => ({
  useTranslations: () => stableT,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { useFilePreview } from "../use-file-preview";

// A non-previewable extension routes through the default case in loadPreview
// (no fetch), keeping the test free of network side effects.
const file = { name: "document.bin", objectName: "obj/document.bin", id: "file-1" };

describe("useFilePreview — B-34 intent wiring", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedDownloadUrl.mockResolvedValue("https://example.test/presigned");
    // Prevent jsdom from attempting a navigation when handleDownload clicks the anchor.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('requests the preview URL with intent "preview" when opened', async () => {
    const { unmount } = renderHook(() =>
      useFilePreview({ file, isOpen: true, shareId: "share-1" }),
    );

    await waitFor(() => expect(mockGetCachedDownloadUrl).toHaveBeenCalled());

    // loadPreview must pass intent "preview" and forward shareId for per-share cache scoping.
    expect(mockGetCachedDownloadUrl).toHaveBeenCalledWith(
      file.objectName,
      undefined,
      "share-1",
      "preview",
    );

    unmount();
  });

  it("requests the download URL with the default (download) intent on explicit download", async () => {
    const { result, unmount } = renderHook(() =>
      useFilePreview({ file, isOpen: true, shareId: "share-1" }),
    );

    await waitFor(() => expect(mockGetCachedDownloadUrl).toHaveBeenCalled());
    mockGetCachedDownloadUrl.mockClear();

    await act(async () => {
      await result.current.handleDownload();
    });

    // handleDownload forwards shareId for cache scoping and must NOT pass "preview".
    expect(mockGetCachedDownloadUrl).toHaveBeenCalledWith(file.objectName, undefined, "share-1");
    expect(mockGetCachedDownloadUrl.mock.calls.at(-1)).not.toContain("preview");

    unmount();
  });
});
