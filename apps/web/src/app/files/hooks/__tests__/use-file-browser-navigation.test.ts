/**
 * @vitest-environment jsdom
 *
 * Tests for the URL ↔ currentFolderId sync in use-file-browser.ts.
 *
 * Covers:
 *   - Initial URL with ?folder=slug resolves correctly
 *   - Programmatic navigation (navigateToFolder) updates both state and URL
 *   - Back/forward navigation (URL changes externally) re-syncs currentFolderId
 *   - No folder param = root folder (null)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────

let mockFolderParam: string | null = null;
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === "folder" ? mockFolderParam : null),
    toString: () => (mockFolderParam ? `folder=${mockFolderParam}` : ""),
    // Support iteration for new URLSearchParams(searchParams)
    [Symbol.iterator]: function* () {
      if (mockFolderParam) yield ["folder", mockFolderParam];
    },
    entries: function* () {
      if (mockFolderParam) yield ["folder", mockFolderParam];
    },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock the file/folder endpoints to return controlled data
const mockListFiles = vi.fn();
const mockListFolders = vi.fn();

vi.mock("@/http/endpoints", () => ({
  listFiles: (...args: unknown[]) => mockListFiles(...args),
}));

vi.mock("@/http/endpoints/folders", () => ({
  listFolders: (...args: unknown[]) => mockListFolders(...args),
}));

vi.mock("@/lib/api-mappers", () => ({
  mapApiFiles: (files: unknown[]) => files,
  mapApiFolders: (folders: unknown[]) => folders,
}));

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    fileBrowser: {
      data: () => ["fileBrowser", "data"],
    },
  },
}));

vi.mock("@/hooks/use-enhanced-file-manager", () => ({
  useEnhancedFileManager: () => ({
    handleDelete: vi.fn(),
    handleEdit: vi.fn(),
    handleMove: vi.fn(),
  }),
}));

import { useFileBrowser } from "../use-file-browser";

// ── Test data ─────────────────────────────────────────────────────────

const FOLDERS = [
  { id: "folder-1", name: "Documents", parentId: undefined, createdAt: "2024-01-01T00:00:00Z" },
  {
    id: "folder-2",
    name: "Photos",
    parentId: "folder-1",
    createdAt: "2024-01-02T00:00:00Z",
  },
  { id: "folder-3", name: "Music", parentId: undefined, createdAt: "2024-01-03T00:00:00Z" },
];

const FILES = [
  {
    id: "file-1",
    name: "readme.txt",
    folderId: undefined,
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "file-2",
    name: "photo.jpg",
    folderId: "folder-2",
    createdAt: "2024-01-02T00:00:00Z",
  },
];

function setupSuccessfulMocks() {
  mockListFiles.mockResolvedValue({ data: { files: FILES } });
  mockListFolders.mockResolvedValue({ data: { folders: FOLDERS } });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("useFileBrowser — URL ↔ folder sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFolderParam = null;
    setupSuccessfulMocks();
  });

  afterEach(() => {
    mockFolderParam = null;
  });

  it("starts at root (currentFolderId = null) when no folder param", async () => {
    mockFolderParam = null;

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentFolderId).toBeNull();
  });

  it("resolves ?folder=documents to folder-1 on initial load", async () => {
    mockFolderParam = "documents";

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.currentFolderId).toBe("folder-1"));
  });

  it("resolves nested ?folder=documents/photos to folder-2", async () => {
    mockFolderParam = "documents/photos";

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.currentFolderId).toBe("folder-2"));
  });

  it("resolves invalid slug to null (root)", async () => {
    mockFolderParam = "nonexistent";

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentFolderId).toBeNull();
  });

  it("navigateToFolder updates state and calls router.push", async () => {
    mockFolderParam = null;

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.navigateToFolder("folder-1");
    });

    expect(result.current.currentFolderId).toBe("folder-1");
    // Should call router.push with a URL containing the folder slug
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("folder=documents"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("navigateToRoot sets currentFolderId to null", async () => {
    mockFolderParam = "documents";

    const { result } = renderHook(() => useFileBrowser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.currentFolderId).toBe("folder-1"));

    act(() => {
      result.current.navigateToRoot();
    });

    expect(result.current.currentFolderId).toBeNull();
    // Should call router.push with no folder param
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/files",
      expect.objectContaining({ scroll: false }),
    );
  });

  it("re-syncs currentFolderId when urlFolderSlug changes (simulates back/forward)", async () => {
    // Start at documents folder
    mockFolderParam = "documents";

    const { result, rerender } = renderHook(() => useFileBrowser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.currentFolderId).toBe("folder-1"));

    // Simulate browser back to root: URL changes, no folder param
    mockFolderParam = null;
    rerender();

    await waitFor(() => expect(result.current.currentFolderId).toBeNull());
  });

  it("re-syncs to a different folder when URL slug changes externally", async () => {
    // Start at root
    mockFolderParam = null;

    const { result, rerender } = renderHook(() => useFileBrowser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentFolderId).toBeNull();

    // Simulate browser forward to music
    mockFolderParam = "music";
    rerender();

    await waitFor(() => expect(result.current.currentFolderId).toBe("folder-3"));
  });
});
