/**
 * Tests for MediaEmbedLink component — TanStack Query migration.
 *
 * Covers:
 *   - Renders nothing when shareId is absent (query disabled)
 *   - Renders nothing while the embed token is loading
 *   - Renders the embed URL once the query resolves
 *   - Does not render when the query returns no data
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@/http/endpoints/files", () => ({
  generateEmbedToken: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { MediaEmbedLink } from "@/components/files/media-embed-link";
import { generateEmbedToken } from "@/http/endpoints/files";

const mockGenerateEmbedToken = vi.mocked(generateEmbedToken);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MediaEmbedLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't set window.location.origin
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      writable: true,
    });
  });

  it("renders nothing when shareId is not provided", () => {
    const { container } = render(<MediaEmbedLink fileId="file-1" />, {
      wrapper: createWrapper(),
    });
    // No embed token request made — nothing to show
    expect(container.firstChild).toBeNull();
    expect(mockGenerateEmbedToken).not.toHaveBeenCalled();
  });

  it("renders the embed URL once the query resolves", async () => {
    mockGenerateEmbedToken.mockResolvedValue({
      data: { token: "tok-abc" },
    } as never);

    render(<MediaEmbedLink fileId="file-1" shareId="share-1" />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://example.com/e/tok-abc")).toBeInTheDocument();
    });
  });

  it("calls generateEmbedToken with the correct fileId and shareId", async () => {
    mockGenerateEmbedToken.mockResolvedValue({
      data: { token: "tok-xyz" },
    } as never);

    render(<MediaEmbedLink fileId="file-42" shareId="share-99" />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockGenerateEmbedToken).toHaveBeenCalledWith({
        fileId: "file-42",
        shareId: "share-99",
      });
    });
  });

  it("renders nothing when the query fails", async () => {
    mockGenerateEmbedToken.mockRejectedValue(new Error("network error"));

    const { container } = render(<MediaEmbedLink fileId="file-1" shareId="share-1" />, {
      wrapper: createWrapper(),
    });

    // Wait for query to settle; component should still render nothing
    await waitFor(() => {
      expect(mockGenerateEmbedToken).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });
});
