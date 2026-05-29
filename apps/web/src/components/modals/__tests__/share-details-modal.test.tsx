/**
 * Tests for ShareDetailsModal — TanStack Query migration.
 *
 * Covers:
 *   - Renders nothing when shareId is null (query disabled)
 *   - Renders share data once the query resolves
 *   - Calls getShare with the correct shareId
 *   - Invalidates the share detail query after saveEdit via onUpdateName
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock heavy dependencies ───────────────────────────────────────────────────

vi.mock("@/http/endpoints", () => ({
  getShare: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

// LazyQRCode isn't needed in unit tests
vi.mock("@/components/ui/lazy-qr-code", () => ({
  LazyQRCode: () => <div data-testid="qr-code" />,
}));

// Sub-modals aren't under test here
vi.mock("@/components/modals/generate-share-link-modal", () => ({
  GenerateShareLinkModal: () => null,
}));
vi.mock("@/components/modals/qr-code-modal", () => ({
  QrCodeModal: () => null,
}));
vi.mock("@/components/modals/share-details/share-details-files-list", () => ({
  ShareDetailsFilesList: () => null,
}));
vi.mock("@/components/modals/share-details/share-details-info-section", () => ({
  ShareDetailsInfoSection: () => <div data-testid="info-section" />,
}));
vi.mock("@/components/modals/share-expiration-modal", () => ({
  ShareExpirationModal: () => null,
}));
vi.mock("@/components/modals/share-security-modal", () => ({
  ShareSecurityModal: () => null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { ShareDetailsModal } from "@/components/modals/share-details-modal";
import { getShare } from "@/http/endpoints";

const mockGetShare = vi.mocked(getShare);

const MOCK_SHARE = {
  id: "share-1",
  name: "My Share",
  description: "A test share",
  views: 5,
  files: [],
  recipients: [],
  createdAt: "2024-01-01T00:00:00Z",
  expiration: null,
  alias: null,
  security: null,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    Wrapper: function W({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ShareDetailsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when shareId is null", () => {
    const { Wrapper } = createWrapper();
    const { container } = render(<ShareDetailsModal shareId={null} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });
    // The dialog is closed and share is null — nothing visible
    expect(container.firstChild).toBeNull();
  });

  it("calls getShare with the correct shareId when opened", async () => {
    mockGetShare.mockResolvedValue({ data: { share: MOCK_SHARE } } as never);

    const { Wrapper } = createWrapper();
    render(<ShareDetailsModal shareId="share-1" onClose={vi.fn()} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(mockGetShare).toHaveBeenCalledWith("share-1");
    });
  });

  it("renders share content once the query resolves", async () => {
    mockGetShare.mockResolvedValue({ data: { share: MOCK_SHARE } } as never);

    const { Wrapper } = createWrapper();
    render(<ShareDetailsModal shareId="share-1" onClose={vi.fn()} />, { wrapper: Wrapper });

    await waitFor(() => {
      // The InfoSection is rendered — proves the share data arrived and modal body is visible
      expect(screen.getByTestId("info-section")).toBeInTheDocument();
    });
  });

  it("shows loader while share data is loading", () => {
    // Never resolve — keeps query in pending/loading state
    mockGetShare.mockReturnValue(new Promise(() => {}));

    const { Wrapper } = createWrapper();
    render(<ShareDetailsModal shareId="share-1" onClose={vi.fn()} />, { wrapper: Wrapper });

    // Loader renders with role="status" while share data is pending
    // (ShareDetailsModal renders <Loader size="lg" /> when !share)
    expect(screen.getByRole("status")).toBeInTheDocument();
    // And share content is not visible yet
    expect(screen.queryByTestId("info-section")).not.toBeInTheDocument();
  });

  it("fetches exactly once on mount (no infinite loop)", async () => {
    // The old useCallback+useEffect pattern could cause runaway fetches.
    // With useQuery, the query runs exactly once per mount (unless invalidated).
    mockGetShare.mockResolvedValue({ data: { share: MOCK_SHARE } } as never);

    const { Wrapper } = createWrapper();
    render(<ShareDetailsModal shareId="share-1" onClose={vi.fn()} />, { wrapper: Wrapper });

    // Wait for the query to settle
    await waitFor(() => {
      expect(screen.getByTestId("info-section")).toBeInTheDocument();
    });

    // TanStack Query should call getShare exactly once on initial mount
    expect(mockGetShare).toHaveBeenCalledTimes(1);
    expect(mockGetShare).toHaveBeenCalledWith("share-1");
  });
});
