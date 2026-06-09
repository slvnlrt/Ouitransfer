/**
 * Tests for RecipientSelector — download-status badge (8.3 Batch 2).
 *
 * Covers the badge derivation rules (spec R-6):
 *   - lastDownloadedAt != null  → "Downloaded" badge (with date in the title tooltip)
 *   - notified but not downloaded → "Pending" badge
 *   - neither notified nor downloaded → no status badge
 *   - the access-count "views" line stays a SEPARATE signal from download status
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// next-intl: return the key for plain strings, and interpolate {placeholders}
// so we can assert the date made it into the tooltip.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    // The key has no ICU placeholders, so append the interpolation values to make
    // them observable in assertions (e.g. the formatted date in the tooltip title).
    if (values && Object.keys(values).length > 0) {
      const rendered = Object.values(values)
        .map((v) => String(v))
        .join(" ");
      return `${key} ${rendered}`;
    }
    return key;
  },
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString(),
    relativeTime: (date: Date) => date.toISOString(),
    number: (n: number) => String(n),
  }),
}));

vi.mock("@/hooks/use-secure-configs", () => ({
  useSecureConfigValue: () => ({ value: "false", isLoading: false }),
}));

vi.mock("@/http/endpoints", () => ({
  addRecipients: vi.fn(),
  notifyRecipients: vi.fn(),
  removeRecipients: vi.fn(),
}));

import { RecipientSelector } from "@/components/general/recipient-selector";
import type { ShareRecipient } from "@/http/endpoints/shares/types";

function makeRecipient(overrides: Partial<ShareRecipient> = {}): ShareRecipient {
  return {
    id: "r-1",
    email: "bob@example.com",
    name: "Bob",
    trackingToken: "tok-1",
    notifiedAt: null,
    lastAccessedAt: null,
    accessCount: 0,
    downloadCount: 0,
    lastDownloadedAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderSelector(recipients: ShareRecipient[]) {
  return render(
    <RecipientSelector shareId="share-1" selectedRecipients={recipients} onSuccess={vi.fn()} />,
  );
}

describe("RecipientSelector download-status badge", () => {
  it("shows the Downloaded badge with the date in the tooltip when lastDownloadedAt is set", () => {
    renderSelector([
      makeRecipient({
        downloadCount: 2,
        lastDownloadedAt: "2024-06-01T10:00:00Z",
        notifiedAt: "2024-05-01T10:00:00Z",
      }),
    ]);

    expect(screen.getByText("recipientSelector.downloaded")).toBeInTheDocument();
    // The Pending badge must NOT appear for a downloader.
    expect(screen.queryByText("recipientSelector.pending")).not.toBeInTheDocument();

    // The formatted date is interpolated into the title-tooltip key.
    const badge = screen.getByText("recipientSelector.downloaded");
    expect(badge.getAttribute("title")).toContain("2024-06-01");
  });

  it("shows the Pending badge when notified but not yet downloaded", () => {
    renderSelector([makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", lastDownloadedAt: null })]);

    expect(screen.getByText("recipientSelector.pending")).toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.downloaded")).not.toBeInTheDocument();
  });

  it("shows no status badge when the recipient is neither notified nor downloaded", () => {
    renderSelector([makeRecipient({ notifiedAt: null, lastDownloadedAt: null })]);

    expect(screen.queryByText("recipientSelector.pending")).not.toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.downloaded")).not.toBeInTheDocument();
  });

  it("keeps the access-count views line distinct from download status", () => {
    // Accessed but never downloaded: views line shows, download badge stays Pending.
    renderSelector([
      makeRecipient({
        accessCount: 3,
        notifiedAt: "2024-05-01T10:00:00Z",
        lastDownloadedAt: null,
      }),
    ]);

    expect(screen.getByText(/recipientSelector\.views/)).toBeInTheDocument();
    expect(screen.getByText("recipientSelector.pending")).toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.downloaded")).not.toBeInTheDocument();
  });
});
