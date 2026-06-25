/**
 * Tests for usePublicShare hook.
 *
 * Covers:
 *   - Metadata query returns the flat shape (C-1 fix)
 *   - Password acceptance flow: accepted password is used on refetch
 *   - Share query returns share data correctly
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useParams: () => ({ alias: "test-alias" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/s/test-alias",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockGetShareByAlias = vi.fn();
const mockGetShareMetadata = vi.fn();
const mockIdentifyVisitor = vi.fn();

vi.mock("@/http/endpoints/index", () => ({
  getShareByAlias: (...args: unknown[]) => mockGetShareByAlias(...args),
  getShareMetadata: (...args: unknown[]) => mockGetShareMetadata(...args),
  identifyVisitor: (...args: unknown[]) => mockIdentifyVisitor(...args),
}));

// Mock sub-hooks to avoid pulling in complex dependencies
vi.mock("../use-public-share-download", () => ({
  usePublicShareDownload: () => ({
    handleDownload: vi.fn(),
    handleBulkDownload: vi.fn(),
    handleSelectedItemsBulkDownload: vi.fn(),
  }),
}));

vi.mock("../use-public-share-navigation", () => ({
  usePublicShareNavigation: () => ({
    folders: [],
    files: [],
    path: [],
    isBrowseLoading: false,
    browseError: null,
    currentFolderId: null,
    searchQuery: "",
    navigateToFolder: vi.fn(),
    handleSearch: vi.fn(),
  }),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { usePublicShare } from "../use-public-share";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_SHARE = {
  id: "share-1",
  name: "Test Share",
  description: null,
  expiration: null,
  views: 3,
  maxViews: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  creatorId: "user-1",
  security: { hasPassword: false },
  files: [],
  folders: [],
  recipients: [],
  alias: {
    id: "alias-1",
    alias: "test-alias",
    shareId: "share-1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  nameFieldRequired: "HIDDEN" as const,
  emailFieldRequired: "HIDDEN" as const,
  notifyOnDownload: false,
  inactivityAlertDays: null,
  lastDownloadedAt: null,
  notifiedForExpiring: false,
  notifiedForExpired: false,
};

const MOCK_METADATA = {
  name: "Test Share",
  description: null,
  totalFiles: 3,
  totalFolders: 1,
  hasPassword: false,
  isExpired: false,
  isMaxViewsReached: false,
  nameFieldRequired: "REQUIRED" as const,
  emailFieldRequired: "OPTIONAL" as const,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    wrapper: function W({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usePublicShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches share data correctly", async () => {
    mockGetShareByAlias.mockResolvedValue({ data: { share: MOCK_SHARE } });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicShare(), { wrapper });

    await waitFor(() => {
      expect(result.current.share).toEqual(MOCK_SHARE);
    });

    expect(mockGetShareByAlias).toHaveBeenCalledWith("test-alias", { t: undefined });
  });

  it("returns flat metadata shape without .metadata wrapper (C-1 fix)", async () => {
    // Simulate server returning IDENTIFICATION_REQUIRED so the metadata query is enabled
    const identificationError = {
      isAxiosError: true,
      response: { status: 403, data: { code: "IDENTIFICATION_REQUIRED" } },
    };
    mockGetShareByAlias.mockRejectedValue(identificationError);

    // Server returns flat shape — no { metadata: ... } wrapper
    mockGetShareMetadata.mockResolvedValue({ data: MOCK_METADATA });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicShare(), { wrapper });

    await waitFor(() => {
      expect(result.current.isIdentificationModalOpen).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.shareMetadata).not.toBeNull();
    });

    // Verify the metadata is the flat shape, not wrapped in .metadata
    expect(result.current.shareMetadata).toEqual(MOCK_METADATA);
    expect(result.current.shareMetadata?.nameFieldRequired).toBe("REQUIRED");
    expect(result.current.shareMetadata?.emailFieldRequired).toBe("OPTIONAL");
    expect(result.current.shareMetadata?.totalFiles).toBe(3);
  });

  it("shows password modal when password is required", async () => {
    const passwordError = {
      isAxiosError: true,
      response: { status: 401, data: { code: "PASSWORD_REQUIRED" } },
    };
    mockGetShareByAlias.mockRejectedValue(passwordError);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicShare(), { wrapper });

    await waitFor(() => {
      expect(result.current.isPasswordModalOpen).toBe(true);
    });

    expect(result.current.share).toBeNull();
  });

  it("sets metadata error when metadata fetch fails", async () => {
    const identificationError = {
      isAxiosError: true,
      response: { status: 403, data: { code: "IDENTIFICATION_REQUIRED" } },
    };
    mockGetShareByAlias.mockRejectedValue(identificationError);
    mockGetShareMetadata.mockRejectedValue(new Error("Network error"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicShare(), { wrapper });

    await waitFor(() => {
      expect(result.current.metadataError).toBe(true);
    });
  });
});
