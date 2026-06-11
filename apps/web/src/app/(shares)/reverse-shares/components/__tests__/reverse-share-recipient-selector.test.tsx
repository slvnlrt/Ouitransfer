/**
 * Tests for ReverseShareRecipientSelector — upload-status badge (8.3 Batch 4 / lot D).
 *
 * Covers the best-effort per-recipient upload badge:
 *   - uploadedAt != null            → "Uploaded" badge (date in the aria-label tooltip)
 *   - notified but not uploaded     → "Pending" badge
 *   - neither notified nor uploaded → no status badge
 *   - R-5 approximate hint: when emailFieldRequired !== "REQUIRED" the badge
 *     carries the "approximate" hint; when "REQUIRED" it does not.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next-intl: echo the key, appending interpolation values so the formatted date
// (and the appended approximate hint) are observable in title assertions.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
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

// SMTP off by default — keeps the notify controls out of the way; the badge logic
// under test is independent of SMTP.
const mockSmtpValue = "false";
vi.mock("@/hooks/use-secure-configs", () => ({
  useSecureConfigValue: () => ({ value: mockSmtpValue, isLoading: false }),
}));

vi.mock("@/http/endpoints/reverse-shares", () => ({
  addReverseShareRecipients: vi.fn(),
  notifyReverseShareRecipients: vi.fn(),
  removeReverseShareRecipients: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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

import { ReverseShareRecipientSelector } from "@/app/(shares)/reverse-shares/components/reverse-share-recipient-selector";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReverseShareRecipient } from "@/http/endpoints/reverse-shares/types";

function makeRecipient(overrides: Partial<ReverseShareRecipient> = {}): ReverseShareRecipient {
  return {
    id: "r-1",
    email: "alice@example.com",
    name: "Alice",
    notifiedAt: null,
    uploadCount: 0,
    uploadedAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderSelector(recipients: ReverseShareRecipient[], emailFieldRequired = "OPTIONAL") {
  return render(
    <TooltipProvider>
      <ReverseShareRecipientSelector
        reverseShareId="rs-1"
        selectedRecipients={recipients}
        reverseShareAlias="my-alias"
        emailFieldRequired={emailFieldRequired}
        onSuccess={vi.fn()}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReverseShareRecipientSelector upload-status badge", () => {
  it("shows the Uploaded badge with the date in the tooltip when uploadedAt is set", () => {
    renderSelector([
      makeRecipient({
        uploadCount: 2,
        uploadedAt: "2024-06-01T10:00:00Z",
        notifiedAt: "2024-05-01T10:00:00Z",
      }),
    ]);

    const badge = screen.getByText("recipientSelector.uploaded");
    expect(badge).toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.pending")).not.toBeInTheDocument();
    expect(badge.getAttribute("aria-label")).toContain("2024-06-01");
  });

  it("shows the Pending badge when notified but not yet uploaded", () => {
    renderSelector([makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", uploadedAt: null })]);

    expect(screen.getByText("recipientSelector.pending")).toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.uploaded")).not.toBeInTheDocument();
  });

  it("shows no status badge when the recipient is neither notified nor uploaded", () => {
    renderSelector([makeRecipient({ notifiedAt: null, uploadedAt: null })]);

    expect(screen.queryByText("recipientSelector.pending")).not.toBeInTheDocument();
    expect(screen.queryByText("recipientSelector.uploaded")).not.toBeInTheDocument();
  });
});

describe("ReverseShareRecipientSelector — R-5 approximate hint", () => {
  it("attaches the approximate hint to the Pending badge when email is not required", () => {
    renderSelector(
      [makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", uploadedAt: null })],
      "OPTIONAL",
    );

    const badge = screen.getByText("recipientSelector.pending");
    expect(badge.getAttribute("aria-label")).toBe("recipientSelector.uploadApproximateHint");
  });

  it("does NOT attach the approximate hint when email is required", () => {
    renderSelector(
      [makeRecipient({ notifiedAt: "2024-05-01T10:00:00Z", uploadedAt: null })],
      "REQUIRED",
    );

    const badge = screen.getByText("recipientSelector.pending");
    expect(badge.getAttribute("aria-label")).toBeNull();
  });

  it("appends the approximate hint to the Uploaded badge tooltip when email is not required", () => {
    renderSelector(
      [makeRecipient({ uploadedAt: "2024-06-01T10:00:00Z", notifiedAt: "2024-05-01T10:00:00Z" })],
      "OPTIONAL",
    );

    const badge = screen.getByText("recipientSelector.uploaded");
    expect(badge.getAttribute("aria-label")).toContain("recipientSelector.uploadApproximateHint");
    expect(badge.getAttribute("aria-label")).toContain("2024-06-01");
  });

  it("omits the approximate hint from the Uploaded badge tooltip when email is required", () => {
    renderSelector(
      [makeRecipient({ uploadedAt: "2024-06-01T10:00:00Z", notifiedAt: "2024-05-01T10:00:00Z" })],
      "REQUIRED",
    );

    const badge = screen.getByText("recipientSelector.uploaded");
    expect(badge.getAttribute("aria-label")).not.toContain(
      "recipientSelector.uploadApproximateHint",
    );
    expect(badge.getAttribute("aria-label")).toContain("2024-06-01");
  });
});
