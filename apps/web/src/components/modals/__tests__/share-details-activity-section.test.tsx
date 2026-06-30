/**
 * Tests for ShareDetailsActivitySection — specifically the VisitEntry component.
 *
 * Covers:
 *   - authenticated_user visit renders the verified source badge (no spoofable hint)
 *   - tracking_token visit renders the verified source badge (baseline)
 *   - cookie visit renders the self-declared badge WITH the spoofable hint tooltip
 *   - anonymous visit renders "anonymous" label, no source badge
 *   - isOwner=true renders the "You" indicator alongside identity
 *   - isOwner=false does NOT render the "You" indicator
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@/http/endpoints", () => ({
  getShareVisits: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    relativeTime: (_date: Date) => "just now",
  }),
}));

// Radix Tooltip requires a Provider; mock it with simple passthrough components
// so we can also assert on TooltipContent text.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? children : <span>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip-content">{children}</span>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { ShareDetailsActivitySection } from "@/components/modals/share-details/share-details-activity-section";
import { getShareVisits } from "@/http/endpoints";
import type { GetShareVisitsResult, ShareVisit } from "@/http/endpoints/shares/types";

const mockGetShareVisits = vi.mocked(getShareVisits);

function makeVisit(overrides: Partial<ShareVisit> = {}): ShareVisit {
  return {
    id: "visit-1",
    action: "access",
    visitorName: "Alice",
    visitorEmail: "alice@example.com",
    createdAt: new Date().toISOString(),
    recipientId: null,
    shareId: "share-1",
    fileId: null,
    fileName: null,
    recipient: null,
    identificationSource: "tracking_token",
    isOwner: false,
    ...overrides,
  };
}

function mockVisitsResponse(visits: ShareVisit[]): GetShareVisitsResult {
  return {
    data: { visits, total: visits.length, page: 1, limit: 10 },
  } as GetShareVisitsResult;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ShareDetailsActivitySection — VisitEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authenticated_user source", () => {
    it("renders the verified source badge with the authenticated_user label key", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ identificationSource: "authenticated_user" })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      // Wait for the badge to appear
      const badge = await screen.findByText("shareDetails.activity.source.authenticated_user");
      expect(badge).toBeInTheDocument();
    });

    it("does NOT render the self-declared spoofable hint for authenticated_user", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ identificationSource: "authenticated_user" })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      await screen.findByText("shareDetails.activity.source.authenticated_user");

      // The spoofable-hint tooltip content must NOT appear for verified sources
      expect(
        screen.queryByText("shareDetails.activity.source.selfDeclaredHint"),
      ).not.toBeInTheDocument();
    });
  });

  describe("isOwner flag", () => {
    it("renders the 'You' indicator when isOwner is true", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([
          makeVisit({ identificationSource: "authenticated_user", isOwner: true }),
        ]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      const youBadge = await screen.findByText("shareDetails.activity.you");
      expect(youBadge).toBeInTheDocument();
    });

    it("does NOT render the 'You' indicator when isOwner is false", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([
          makeVisit({ identificationSource: "authenticated_user", isOwner: false }),
        ]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      await screen.findByText("shareDetails.activity.source.authenticated_user");

      expect(screen.queryByText("shareDetails.activity.you")).not.toBeInTheDocument();
    });
  });

  describe("cookie source (baseline — spoofable path)", () => {
    it("renders the self-declared spoofable hint tooltip for cookie source", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ identificationSource: "cookie" })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      // The tooltip content (selfDeclaredHint) is rendered in the DOM even when not visible
      const hint = await screen.findByText("shareDetails.activity.source.selfDeclaredHint");
      expect(hint).toBeInTheDocument();
    });
  });

  describe("tracking_token source (baseline — verified path)", () => {
    it("renders the verified source badge with the tracking_token label key", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ identificationSource: "tracking_token" })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      const badge = await screen.findByText("shareDetails.activity.source.tracking_token");
      expect(badge).toBeInTheDocument();
    });

    it("does NOT render the self-declared spoofable hint for tracking_token", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ identificationSource: "tracking_token" })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      await screen.findByText("shareDetails.activity.source.tracking_token");

      expect(
        screen.queryByText("shareDetails.activity.source.selfDeclaredHint"),
      ).not.toBeInTheDocument();
    });
  });

  // B-34: three distinct activity rows. "access" is share-level (Eye, no file name),
  // "preview" and "download" are file-level (FileSearch / Download, with a file name).
  // The label key + presence of a file name must keep them unambiguous.
  describe("B-34 — action rendering (access / preview / download)", () => {
    it("renders the preview label and the file name for a preview visit", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([
          makeVisit({ action: "preview", fileId: "file-1", fileName: "report.pdf" }),
        ]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      expect(await screen.findByText("shareDetails.activity.preview")).toBeInTheDocument();
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      // A file-level preview must NOT be conflated with a share-level access row.
      expect(screen.queryByText("shareDetails.activity.access")).not.toBeInTheDocument();
    });

    it("renders the download label and the file name for a download visit", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([
          makeVisit({ action: "download", fileId: "file-2", fileName: "archive.zip" }),
        ]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      expect(await screen.findByText("shareDetails.activity.download")).toBeInTheDocument();
      expect(screen.getByText("archive.zip")).toBeInTheDocument();
    });

    it("renders the access label and NO file name for a share-level access visit", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ action: "access", fileId: null, fileName: null })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      expect(await screen.findByText("shareDetails.activity.access")).toBeInTheDocument();
      // No file name paragraph for a share-level access.
      expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
      expect(screen.queryByText("shareDetails.activity.preview")).not.toBeInTheDocument();
      expect(screen.queryByText("shareDetails.activity.download")).not.toBeInTheDocument();
    });

    it("omits the file name when a preview/download visit has a null fileName (deleted file)", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([makeVisit({ action: "download", fileId: "file-3", fileName: null })]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      // The action row still renders, just without a file-name line.
      expect(await screen.findByText("shareDetails.activity.download")).toBeInTheDocument();
    });
  });

  describe("anonymous source", () => {
    it("renders the anonymous label and no source badge", async () => {
      mockGetShareVisits.mockResolvedValue(
        mockVisitsResponse([
          makeVisit({
            identificationSource: "anonymous",
            visitorName: null,
            visitorEmail: null,
          }),
        ]),
      );

      render(<ShareDetailsActivitySection shareId="share-1" />, { wrapper: createWrapper() });

      const anonLabel = await screen.findByText("shareDetails.activity.anonymous");
      expect(anonLabel).toBeInTheDocument();

      // No source badge for anonymous
      expect(
        screen.queryByText("shareDetails.activity.source.tracking_token"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("shareDetails.activity.source.cookie")).not.toBeInTheDocument();
      expect(
        screen.queryByText("shareDetails.activity.source.authenticated_user"),
      ).not.toBeInTheDocument();
    });
  });
});
