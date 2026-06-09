/**
 * Tests for RecipientSelector — download-status badge (8.3 Batch 2).
 *
 * Covers the badge derivation rules (spec R-6):
 *   - lastDownloadedAt != null  → "Downloaded" badge (with date in the title tooltip)
 *   - notified but not downloaded → "Pending" badge
 *   - neither notified nor downloaded → no status badge
 *   - the access-count "views" line stays a SEPARATE signal from download status
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Mutable SMTP flag so individual tests can enable/disable SMTP-gated controls.
let mockSmtpValue = "false";
vi.mock("@/hooks/use-secure-configs", () => ({
  useSecureConfigValue: () => ({ value: mockSmtpValue, isLoading: false }),
}));

const mockRemindNonDownloaders = vi.fn();
vi.mock("@/http/endpoints", () => ({
  addRecipients: vi.fn(),
  notifyRecipients: vi.fn(),
  removeRecipients: vi.fn(),
  remindNonDownloaders: (...args: unknown[]) => mockRemindNonDownloaders(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
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
    <RecipientSelector
      shareId="share-1"
      selectedRecipients={recipients}
      shareAlias="my-alias"
      onSuccess={vi.fn()}
    />,
  );
}

beforeEach(() => {
  mockSmtpValue = "false";
  mockRemindNonDownloaders.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

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

describe("RecipientSelector — remind non-downloaders button", () => {
  function getRemindButton() {
    // The button label key is "recipientSelector.remindNonDownloaders <count>"
    // (the mock appends interpolation values). Match the prefix.
    return screen.getByRole("button", { name: /recipientSelector\.remindNonDownloaders/ });
  }

  it("is hidden when SMTP is disabled", () => {
    mockSmtpValue = "false";
    renderSelector([makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", lastDownloadedAt: null })]);

    expect(
      screen.queryByRole("button", { name: /recipientSelector\.remindNonDownloaders/ }),
    ).not.toBeInTheDocument();
  });

  it("is enabled when there is at least one pending (notified, not downloaded) recipient", () => {
    mockSmtpValue = "true";
    renderSelector([makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", lastDownloadedAt: null })]);

    expect(getRemindButton()).toBeEnabled();
  });

  it("is disabled when every notified recipient has already downloaded", () => {
    mockSmtpValue = "true";
    renderSelector([
      makeRecipient({
        notifiedAt: "2024-05-01T10:00:00Z",
        lastDownloadedAt: "2024-06-01T10:00:00Z",
      }),
    ]);

    expect(getRemindButton()).toBeDisabled();
  });

  it("is disabled when there are recipients but none have been notified", () => {
    mockSmtpValue = "true";
    renderSelector([makeRecipient({ notifiedAt: null, lastDownloadedAt: null })]);

    expect(getRemindButton()).toBeDisabled();
  });

  it("calls remindNonDownloaders with no email filter when clicked", async () => {
    mockSmtpValue = "true";
    mockRemindNonDownloaders.mockResolvedValue({
      data: { remindedRecipients: ["bob@example.com"] },
    });
    const user = userEvent.setup();
    renderSelector([makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", lastDownloadedAt: null })]);

    await user.click(getRemindButton());

    await waitFor(() => {
      expect(mockRemindNonDownloaders).toHaveBeenCalledWith("share-1", {});
    });
  });
});
