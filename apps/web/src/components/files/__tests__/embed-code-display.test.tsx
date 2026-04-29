/**
 * Tests for EmbedCodeDisplay component — TanStack Query migration.
 *
 * Covers:
 *   - Renders nothing when shareId is absent
 *   - Renders embed URL tabs once the query resolves
 *   - Calls generateEmbedToken with correct args
 *   - Renders nothing when the query fails
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

import { EmbedCodeDisplay } from "@/components/files/embed-code-display";
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

describe("EmbedCodeDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      writable: true,
    });
  });

  it("renders nothing when shareId is not provided", () => {
    const { container } = render(
      <EmbedCodeDisplay
        imageUrl="https://example.com/img.png"
        fileName="photo.png"
        fileId="file-1"
      />,
      { wrapper: createWrapper() },
    );
    expect(container.firstChild).toBeNull();
    expect(mockGenerateEmbedToken).not.toHaveBeenCalled();
  });

  it("renders embed URL in the direct-link tab once the query resolves", async () => {
    mockGenerateEmbedToken.mockResolvedValue({
      data: { token: "tok-embed" },
    } as never);

    render(
      <EmbedCodeDisplay
        imageUrl="https://example.com/img.png"
        fileName="photo.png"
        fileId="file-1"
        shareId="share-1"
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://example.com/e/tok-embed")).toBeInTheDocument();
    });
  });

  it("calls generateEmbedToken with the correct fileId and shareId", async () => {
    mockGenerateEmbedToken.mockResolvedValue({
      data: { token: "tok-123" },
    } as never);

    render(
      <EmbedCodeDisplay
        imageUrl="https://example.com/img.png"
        fileName="photo.png"
        fileId="file-42"
        shareId="share-99"
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockGenerateEmbedToken).toHaveBeenCalledWith({
        fileId: "file-42",
        shareId: "share-99",
      });
    });
  });

  it("renders nothing when the query fails", async () => {
    mockGenerateEmbedToken.mockRejectedValue(new Error("network error"));

    const { container } = render(
      <EmbedCodeDisplay
        imageUrl="https://example.com/img.png"
        fileName="photo.png"
        fileId="file-1"
        shareId="share-1"
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockGenerateEmbedToken).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });
});
