/**
 * @vitest-environment jsdom
 *
 * Tests for use-folder-crud.ts — B-24 share-check behavior.
 *
 * Verifies:
 * - handleFolderDelete with 200 → clears folderToDelete, shows success toast
 * - handleFolderDelete with 409 → sets folderInSharesWarning state
 * - handleFolderForceDelete with 200 → clears both states, shows success toast
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so mocks are available inside vi.mock factories
const { mockDeleteFolder, mockRegisterFolder, mockUpdateFolder } = vi.hoisted(() => ({
  mockDeleteFolder: vi.fn(),
  mockRegisterFolder: vi.fn(),
  mockUpdateFolder: vi.fn(),
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

vi.mock("@/http/endpoints/folders", () => ({
  deleteFolder: mockDeleteFolder,
  registerFolder: mockRegisterFolder,
  updateFolder: mockUpdateFolder,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { toast } from "sonner";

import { useFolderCrud } from "../use-folder-crud";

describe("useFolderCrud — B-24 share-check behavior", () => {
  const mockOnRefresh = vi.fn().mockResolvedValue(undefined);
  const mockImmediateUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handleFolderDelete with 200 → removes folder from UI, shows success toast", async () => {
    mockDeleteFolder.mockResolvedValue({ data: { message: "Folder deleted successfully." } });

    const { result } = renderHook(() => useFolderCrud(mockOnRefresh, mockImmediateUpdate));

    // Set folderToDelete state first (simulating user clicking delete)
    act(() => {
      result.current.setFolderToDelete({ id: "folder-1", name: "My Folder" });
    });

    await act(async () => {
      await result.current.handleFolderDelete("folder-1", "My Folder");
    });

    expect(mockDeleteFolder).toHaveBeenCalledWith("folder-1");
    expect(mockImmediateUpdate).toHaveBeenCalledWith("folder-1", "folder", "__DELETE__");
    expect(toast.success).toHaveBeenCalledWith("folderActions.folderDeleted");
    expect(result.current.folderToDelete).toBeNull();
    expect(result.current.folderInSharesWarning).toBeNull();
  });

  it("handleFolderDelete with 409 → sets folderInSharesWarning, does NOT remove from UI", async () => {
    const axiosError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: "FOLDER_IN_SHARES", shareCount: 2, message: "Folder in shares" },
      },
    };
    mockDeleteFolder.mockRejectedValue(axiosError);

    // Mock axios.isAxiosError to return true for our mock error
    const axiosModule = await import("axios");
    vi.spyOn(axiosModule.default, "isAxiosError").mockReturnValue(true);

    const { result } = renderHook(() => useFolderCrud(mockOnRefresh, mockImmediateUpdate));

    // Set folderToDelete state first
    act(() => {
      result.current.setFolderToDelete({ id: "folder-1", name: "My Folder" });
    });

    await act(async () => {
      await result.current.handleFolderDelete("folder-1", "My Folder");
    });

    expect(mockDeleteFolder).toHaveBeenCalledWith("folder-1");
    // Folder should NOT be removed from UI (no optimistic update on 409)
    expect(mockImmediateUpdate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Warning state should be set with name from parameter (not from state)
    expect(result.current.folderInSharesWarning).toEqual({
      id: "folder-1",
      name: "My Folder",
      shareCount: 2,
    });
    expect(result.current.folderToDelete).toBeNull();
  });

  it("handleFolderForceDelete with 200 → clears both states, removes from UI, shows success", async () => {
    mockDeleteFolder.mockResolvedValue({ data: { message: "Folder deleted successfully." } });

    const { result } = renderHook(() => useFolderCrud(mockOnRefresh, mockImmediateUpdate));

    // Simulate: warning dialog is showing
    act(() => {
      result.current.setFolderInSharesWarning({
        id: "folder-1",
        name: "My Folder",
        shareCount: 2,
      });
    });

    await act(async () => {
      await result.current.handleFolderForceDelete("folder-1");
    });

    expect(mockDeleteFolder).toHaveBeenCalledWith("folder-1", true);
    expect(mockImmediateUpdate).toHaveBeenCalledWith("folder-1", "folder", "__DELETE__");
    expect(toast.success).toHaveBeenCalledWith("folderActions.folderDeleted");
    expect(result.current.folderInSharesWarning).toBeNull();
    expect(result.current.folderToDelete).toBeNull();
  });
});
