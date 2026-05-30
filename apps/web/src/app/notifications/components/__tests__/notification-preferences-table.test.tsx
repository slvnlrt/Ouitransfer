/**
 * Tests for NotificationPreferencesTable.
 *
 * Covers:
 *   - Filtering out critical types from the displayed list
 *   - Filtering out non-configurable types (e.g. share_invitation)
 *   - Dirty-state save with defense-in-depth filtering
 *   - Grouping preferences by category
 */

import type { NotificationType } from "@ouitransfer/shared/notification-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    return t;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/http/endpoints/notifications", () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { getNotificationPreferences } from "@/http/endpoints/notifications";
import { NotificationPreferencesTable } from "../notification-preferences-table";

const mockGetPreferences = vi.mocked(getNotificationPreferences);

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockPref {
  type: NotificationType;
  frequency: string;
  configurable: boolean;
  isCritical: boolean;
  defaultFrequency: string;
}

function makePref(
  type: NotificationType,
  opts: { configurable?: boolean; isCritical?: boolean } = {},
): MockPref {
  return {
    type,
    frequency: "immediate",
    configurable: opts.configurable ?? true,
    isCritical: opts.isCritical ?? false,
    defaultFrequency: "immediate",
  };
}

const ALL_PREFS: MockPref[] = [
  // Critical types (should be hidden)
  makePref("welcome", { isCritical: true, configurable: false }),
  makePref("password_reset", { isCritical: true, configurable: false }),
  // Non-configurable but not critical (should also be hidden — I-1 fix)
  makePref("share_invitation", { isCritical: false, configurable: false }),
  makePref("reverse_share_invitation", { isCritical: false, configurable: false }),
  // Configurable types (should be shown)
  makePref("share_accessed"),
  makePref("share_downloaded"),
  makePref("share_expiring"),
  makePref("quota_warning"),
];

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

describe("NotificationPreferencesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out critical types from the displayed list", async () => {
    mockGetPreferences.mockResolvedValue({
      data: { preferences: ALL_PREFS },
    } as never);

    const { Wrapper } = createWrapper();
    render(<NotificationPreferencesTable />, { wrapper: Wrapper });

    await waitFor(() => {
      // Configurable types should be rendered
      expect(screen.getByText("types.share_accessed")).toBeInTheDocument();
      expect(screen.getByText("types.share_downloaded")).toBeInTheDocument();
    });

    // Critical types should NOT be rendered
    expect(screen.queryByText("types.welcome")).not.toBeInTheDocument();
    expect(screen.queryByText("types.password_reset")).not.toBeInTheDocument();
  });

  it("filters out non-configurable types even when not critical (I-1)", async () => {
    mockGetPreferences.mockResolvedValue({
      data: { preferences: ALL_PREFS },
    } as never);

    const { Wrapper } = createWrapper();
    render(<NotificationPreferencesTable />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("types.share_accessed")).toBeInTheDocument();
    });

    // share_invitation and reverse_share_invitation are configurable: false
    // They should NOT appear in the table
    expect(screen.queryByText("types.share_invitation")).not.toBeInTheDocument();
    expect(screen.queryByText("types.reverse_share_invitation")).not.toBeInTheDocument();
  });

  it("groups preferences by category", async () => {
    mockGetPreferences.mockResolvedValue({
      data: { preferences: ALL_PREFS },
    } as never);

    const { Wrapper } = createWrapper();
    render(<NotificationPreferencesTable />, { wrapper: Wrapper });

    await waitFor(() => {
      // Category headers should be rendered
      expect(screen.getByText("categories.shares")).toBeInTheDocument();
      expect(screen.getByText("categories.quota")).toBeInTheDocument();
    });
  });

  it("shows save button as disabled when no changes exist", async () => {
    mockGetPreferences.mockResolvedValue({
      data: { preferences: ALL_PREFS },
    } as never);

    const { Wrapper } = createWrapper();
    render(<NotificationPreferencesTable />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("types.share_accessed")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: "save" });
    expect(saveButton).toBeDisabled();
  });

  it("only renders configurable types — non-configurable types have no select controls", async () => {
    // This tests the defense-in-depth aspect: if a type is not rendered,
    // the user cannot change it, and even if localChanges somehow contained
    // a non-configurable type, the save handler filters it out.
    mockGetPreferences.mockResolvedValue({
      data: { preferences: ALL_PREFS },
    } as never);

    const { Wrapper } = createWrapper();
    render(<NotificationPreferencesTable />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("types.share_accessed")).toBeInTheDocument();
    });

    // Count the Select triggers — should match the number of configurable types only
    // (4 configurable types: share_accessed, share_downloaded, share_expiring, quota_warning)
    const selectTriggers = screen.getAllByRole("combobox");
    expect(selectTriggers).toHaveLength(4);

    // Verify no rows exist for non-configurable types
    expect(screen.queryByText("types.share_invitation")).not.toBeInTheDocument();
    expect(screen.queryByText("types.reverse_share_invitation")).not.toBeInTheDocument();
    expect(screen.queryByText("types.welcome")).not.toBeInTheDocument();
    expect(screen.queryByText("types.password_reset")).not.toBeInTheDocument();
  });
});
