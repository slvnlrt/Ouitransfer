/**
 * @vitest-environment jsdom
 *
 * Tests for use-file-crud.ts — B-21 share-check behavior.
 *
 * Verifies:
 * - handleDelete with 200 → clears fileToDelete, shows success toast
 * - handleDelete with 409 → sets fileInSharesWarning state
 * - handleForceDelete with 200 → clears both states, shows success toast
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so mocks are available inside vi.mock factories
const { mockDeleteFile, mockUpdateFile } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockUpdateFile: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn().mockReturnValue("toast-id"),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/http/endpoints", () => ({
  deleteFile: mockDeleteFile,
  updateFile: mockUpdateFile,
}));

vi.mock("@/http/endpoints/files", () => ({
  // Re-export the type — not needed at runtime but prevents import errors
}));

vi.mock("@/lib/download-url-cache", () => ({
  getCachedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/download"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { toast } from "sonner";

import { useFileCrud } from "../use-file-crud";

describe("useFileCrud — B-21 share-check behavior", () => {
  const mockImmediateUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handleDelete with 200 → removes file from UI, shows success toast", async () => {
    mockDeleteFile.mockResolvedValue({ data: { message: "File deleted successfully." } });

    const { result } = renderHook(() => useFileCrud(mockImmediateUpdate));

    // Set fileToDelete state first (simulating user clicking delete)
    act(() => {
      result.current.setFileToDelete({ id: "file-1", name: "photo.jpg" });
    });

    await act(async () => {
      await result.current.handleDelete("file-1");
    });

    expect(mockDeleteFile).toHaveBeenCalledWith("file-1");
    expect(mockImmediateUpdate).toHaveBeenCalledWith("file-1", "file", "__DELETE__");
    expect(toast.success).toHaveBeenCalledWith("files.deleteSuccess");
    expect(result.current.fileToDelete).toBeNull();
    expect(result.current.fileInSharesWarning).toBeNull();
  });

  it("handleDelete with 409 → sets fileInSharesWarning, does NOT remove from UI", async () => {
    const axiosError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: "FILE_IN_SHARES", shareCount: 2, message: "File in shares" },
      },
    };
    mockDeleteFile.mockRejectedValue(axiosError);

    // Mock axios.isAxiosError to return true for our mock error
    const axiosModule = await import("axios");
    vi.spyOn(axiosModule.default, "isAxiosError").mockReturnValue(true);

    const { result } = renderHook(() => useFileCrud(mockImmediateUpdate));

    // Set fileToDelete state first
    act(() => {
      result.current.setFileToDelete({ id: "file-1", name: "photo.jpg" });
    });

    await act(async () => {
      await result.current.handleDelete("file-1");
    });

    expect(mockDeleteFile).toHaveBeenCalledWith("file-1");
    // File should NOT be removed from UI (no optimistic update on 409)
    expect(mockImmediateUpdate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Warning state should be set
    expect(result.current.fileInSharesWarning).toEqual({
      id: "file-1",
      name: "photo.jpg",
      shareCount: 2,
    });
    expect(result.current.fileToDelete).toBeNull();
  });

  it("handleForceDelete with 200 → clears both states, removes from UI, shows success", async () => {
    mockDeleteFile.mockResolvedValue({ data: { message: "File deleted successfully." } });

    const { result } = renderHook(() => useFileCrud(mockImmediateUpdate));

    // Simulate: warning dialog is showing
    act(() => {
      result.current.setFileInSharesWarning({ id: "file-1", name: "photo.jpg", shareCount: 2 });
    });

    await act(async () => {
      await result.current.handleForceDelete("file-1");
    });

    expect(mockDeleteFile).toHaveBeenCalledWith("file-1", true);
    expect(mockImmediateUpdate).toHaveBeenCalledWith("file-1", "file", "__DELETE__");
    expect(toast.success).toHaveBeenCalledWith("files.deleteSuccess");
    expect(result.current.fileInSharesWarning).toBeNull();
    expect(result.current.fileToDelete).toBeNull();
  });

  it("handleDelete with non-409 error → shows error toast", async () => {
    const genericError = new Error("Network error");
    mockDeleteFile.mockRejectedValue(genericError);

    const { result } = renderHook(() => useFileCrud(mockImmediateUpdate));

    await act(async () => {
      await result.current.handleDelete("file-1");
    });

    expect(toast.error).toHaveBeenCalledWith("files.deleteError");
    expect(result.current.fileInSharesWarning).toBeNull();
  });
});
