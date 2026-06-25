/**
 * @vitest-environment jsdom
 *
 * Tests for use-qr-download.ts.
 *
 * Verifies:
 * - null container → download helper is not called, no state churn
 * - container without an <svg> → helper is not called
 * - container with an <svg> → helper called with the svg + filename
 * - download failure → error logged, isDownloading reset
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDownloadQrCodeAsPng, mockLoggerError } = vi.hoisted(() => ({
  mockDownloadQrCodeAsPng: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@/utils/qr-download", () => ({
  downloadQrCodeAsPng: mockDownloadQrCodeAsPng,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mockLoggerError },
}));

import { useQrDownload } from "../use-qr-download";

function makeContainer(withSvg: boolean): HTMLDivElement {
  const div = document.createElement("div");
  if (withSvg) {
    div.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  }
  return div;
}

describe("useQrDownload", () => {
  beforeEach(() => {
    mockDownloadQrCodeAsPng.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when the container is null", async () => {
    const { result } = renderHook(() => useQrDownload());

    await act(async () => {
      await result.current.downloadQr(null, "file.png");
    });

    expect(mockDownloadQrCodeAsPng).not.toHaveBeenCalled();
    expect(result.current.isDownloading).toBe(false);
  });

  it("does nothing when the container has no svg", async () => {
    const { result } = renderHook(() => useQrDownload());

    await act(async () => {
      await result.current.downloadQr(makeContainer(false), "file.png");
    });

    expect(mockDownloadQrCodeAsPng).not.toHaveBeenCalled();
    expect(result.current.isDownloading).toBe(false);
  });

  it("downloads the svg found inside the container", async () => {
    const container = makeContainer(true);
    const { result } = renderHook(() => useQrDownload());

    await act(async () => {
      await result.current.downloadQr(container, "file.png");
    });

    expect(mockDownloadQrCodeAsPng).toHaveBeenCalledTimes(1);
    const [svgArg, filenameArg] = mockDownloadQrCodeAsPng.mock.calls[0];
    expect(svgArg).toBe(container.querySelector("svg"));
    expect(filenameArg).toBe("file.png");
    expect(result.current.isDownloading).toBe(false);
  });

  it("logs and resets state when the download fails", async () => {
    mockDownloadQrCodeAsPng.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useQrDownload());

    await act(async () => {
      await result.current.downloadQr(makeContainer(true), "file.png");
    });

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0][1]).toEqual({ err: "boom" });
    expect(result.current.isDownloading).toBe(false);
  });
});
