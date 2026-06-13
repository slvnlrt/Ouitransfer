import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UseSystemStatusResult } from "@/hooks/use-system-status";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock ErrorDisplay
vi.mock("@/components/error-display", () => ({
  ErrorDisplay: ({
    title,
    message,
  }: {
    title: string;
    message: string;
    variant?: string;
    actions?: unknown[];
  }) => (
    <div data-testid="error-display">
      {title}: {message}
    </div>
  ),
}));

// Mock Progress
vi.mock("@/components/ui/progress", () => ({
  Progress: (props: { value: number; "aria-label": string; className?: string }) => (
    <div
      data-testid="progress"
      role="progressbar"
      aria-valuenow={props.value}
      aria-label={props["aria-label"]}
    />
  ),
}));

// formatStorageSize is tested separately in src/utils/__tests__/format-storage-size.test.ts
// Here we mock it to isolate the component's rendering logic from formatting details
vi.mock("@/utils/format-storage-size", () => ({
  formatStorageSize: (size: number) => `${size} GB`,
}));

// Mock useDashboardMetrics
vi.mock("@/contexts/dashboard-metrics-context", () => ({
  useDashboardMetrics: vi.fn(() => ({ fileCount: 42, activeShareCount: 5 })),
  DashboardMetricsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useDashboardMetrics } from "@/contexts/dashboard-metrics-context";

// Mutable mock for useSystemStatus
const mockStatus: UseSystemStatusResult = {
  healthStatus: { status: "healthy" as const, email: "ok" as const },
  healthStatusLoading: false,
  healthStatusError: null,
  healthData: null,
  healthLoading: false,
  healthError: false,
  diskSpace: {
    diskSizeGB: 100,
    diskUsedGB: 25,
    diskAvailableGB: 75,
    uploadAllowed: true,
    warningLevel: "none",
    percentage: 25,
  },
  diskSpaceLoading: false,
  diskSpaceError: null,
  adminStats: null,
  adminStatsLoading: false,
  adminStatsError: null,
  emailStats: null,
  emailStatsLoading: false,
  emailStatsError: null,
  isAdmin: false,
  isRefreshing: false,
  refresh: vi.fn(),
};

let currentMockStatus: UseSystemStatusResult = { ...mockStatus };

vi.mock("@/hooks/use-system-status", () => ({
  useSystemStatus: (_options?: { isExpanded?: boolean }) => currentMockStatus,
}));

import { SystemStatusBar } from "../system-status-bar";

describe("SystemStatusBar", () => {
  beforeEach(() => {
    currentMockStatus = { ...mockStatus, refresh: vi.fn() };
  });

  // ── Collapsed state ──────────────────────────────────────────────────────

  describe("collapsed state", () => {
    it("renders collapsed tab by default", () => {
      render(<SystemStatusBar />);
      // The collapsed tab has a button with aria-label="expand"
      expect(screen.getByRole("button", { name: "expand" })).toBeInTheDocument();
    });

    it("shows system status title in collapsed tab", () => {
      render(<SystemStatusBar />);
      // Both collapsed tab and always-in-DOM expanded panel contain "title" text;
      // verify at least one is rendered (the collapsed tab is visible)
      const titles = screen.getAllByText("title");
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    it("has a status dot in collapsed tab", () => {
      render(<SystemStatusBar />);
      // The status dot is an aria-hidden span inside the button
      const button = screen.getByRole("button", { name: "expand" });
      expect(button).toBeInTheDocument();
      // Button should be visible which implies dot and title rendered
    });

    it("does NOT show quota badge when status is healthy (no warning)", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: {
          diskSizeGB: 100,
          diskUsedGB: 25,
          diskAvailableGB: 75,
          uploadAllowed: true,
          warningLevel: "none",
          percentage: 25,
        },
      };
      render(<SystemStatusBar />);
      // The collapsed tab button should NOT contain a quota badge.
      // The expanded panel (always in DOM, aria-hidden) may show percentage text,
      // so we scope the check to the expand button itself.
      const expandButton = screen.getByRole("button", { name: "expand" });
      expect(within(expandButton).queryByText("25%")).not.toBeInTheDocument();
    });

    it("shows quota badge when warning level is 'warning'", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: {
          diskSizeGB: 100,
          diskUsedGB: 75,
          diskAvailableGB: 25,
          uploadAllowed: true,
          warningLevel: "warning",
          percentage: 75,
        },
      };
      render(<SystemStatusBar />);
      // Scope to expand button — the badge is inside the collapsed tab button
      const expandButton = screen.getByRole("button", { name: "expand" });
      expect(within(expandButton).getByText("75%")).toBeInTheDocument();
    });

    it("shows quota badge when warning level is 'critical'", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: {
          diskSizeGB: 100,
          diskUsedGB: 90,
          diskAvailableGB: 10,
          uploadAllowed: true,
          warningLevel: "critical",
          percentage: 90,
        },
      };
      render(<SystemStatusBar />);
      const expandButton = screen.getByRole("button", { name: "expand" });
      expect(within(expandButton).getByText("90%")).toBeInTheDocument();
    });

    it("shows quota badge when warning level is 'exceeded'", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: {
          diskSizeGB: 100,
          diskUsedGB: 100,
          diskAvailableGB: 0,
          uploadAllowed: false,
          warningLevel: "exceeded",
          percentage: 100,
        },
      };
      render(<SystemStatusBar />);
      const expandButton = screen.getByRole("button", { name: "expand" });
      expect(within(expandButton).getByText("100%")).toBeInTheDocument();
    });

    it("does NOT show quota badge when diskSpace is null", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: null,
      };
      render(<SystemStatusBar />);
      // No percentage badge should appear in the collapsed tab button
      const button = screen.getByRole("button", { name: "expand" });
      expect(button).toBeInTheDocument();
      expect(within(button).queryByText(/\d+%/)).not.toBeInTheDocument();
    });

    it("shows dimmed tab when loading", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusLoading: true,
      };
      render(<SystemStatusBar />);
      // Collapsed tab still renders, just visually dimmed (no quota badge)
      expect(screen.getByRole("button", { name: "expand" })).toBeInTheDocument();
    });
  });

  // ── Expanded state ───────────────────────────────────────────────────────

  describe("expanded state", () => {
    it("expands on click of the collapsed tab button", () => {
      render(<SystemStatusBar />);
      const expandButton = screen.getByRole("button", { name: "expand" });
      fireEvent.click(expandButton);
      // After expanding, the collapse button should appear
      expect(screen.getByRole("button", { name: "collapse" })).toBeInTheDocument();
    });

    it("shows collapse button when expanded", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("button", { name: "collapse" })).toBeInTheDocument();
    });

    it("shows refresh button when expanded", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("button", { name: "refresh" })).toBeInTheDocument();
    });

    it("collapses back on collapse button click", () => {
      render(<SystemStatusBar />);
      const expandButton = screen.getByRole("button", { name: "expand" });
      expect(expandButton).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(expandButton);
      const collapseButton = screen.getByRole("button", { name: "collapse" });
      expect(collapseButton).toBeInTheDocument();
      expect(collapseButton).toHaveAttribute("aria-expanded", "true");
      expect(collapseButton).toHaveAttribute("aria-controls", "system-status-panel");

      fireEvent.click(collapseButton);
      // Back to collapsed state
      const newExpandButton = screen.getByRole("button", { name: "expand" });
      expect(newExpandButton).toBeInTheDocument();
      expect(newExpandButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "collapse" })).not.toBeInTheDocument();
    });

    it("calls refresh when refresh button is clicked", () => {
      const refreshFn = vi.fn();
      currentMockStatus = { ...mockStatus, refresh: refreshFn };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      fireEvent.click(screen.getByRole("button", { name: "refresh" }));
      expect(refreshFn).toHaveBeenCalledTimes(1);
    });

    it("shows status badge label when expanded and healthy", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // Status badge shows "status.healthy" (translated as key)
      expect(screen.getByText("status.healthy")).toBeInTheDocument();
    });

    it("shows section with aria-label when expanded", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // Section element with aria-label="title" is role="region"
      expect(screen.getByRole("region", { name: "title" })).toBeInTheDocument();
    });

    it("shows title text in expanded panel", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // "title" text appears in the expanded panel header
      const titleElements = screen.getAllByText("title");
      expect(titleElements.length).toBeGreaterThan(0);
    });
  });

  // ── User view content ────────────────────────────────────────────────────

  describe("user view content", () => {
    it("shows quota progress bar when expanded with disk space data", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("progressbar", { name: "quota.ariaLabel" })).toBeInTheDocument();
    });

    it("shows personal metrics: file count from dashboard context", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // fileCount = 42 from mock
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("shows personal metrics: active share count from dashboard context", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // activeShareCount = 5 from mock
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("shows myFiles and activeShares metric labels", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("metrics.myFiles")).toBeInTheDocument();
      expect(screen.getByText("metrics.activeShares")).toBeInTheDocument();
    });

    it("shows formatted storage sizes", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // formatStorageSize(25) = "25 GB" and formatStorageSize(100) = "100 GB"
      expect(screen.getByText("25 GB / 100 GB")).toBeInTheDocument();
    });

    it("shows 'unlimited' label when diskAvailableGB is -1", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: {
          diskSizeGB: 0,
          diskUsedGB: 10,
          diskAvailableGB: -1,
          uploadAllowed: true,
          warningLevel: "none",
          percentage: 0,
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // "quota.unlimited" is a text node inside a <span> that also contains "(" and ")"
      // The span's normalized text content is "( quota.unlimited )"
      // Use a regex to match any element that contains the key
      expect(screen.getByText(/quota\.unlimited/)).toBeInTheDocument();
    });
  });

  // ── Admin view ───────────────────────────────────────────────────────────

  describe("admin view", () => {
    const adminHealthData = {
      status: "healthy" as const,
      timestamp: "2026-05-23T00:00:00.000Z",
      uptime: 7200, // 2 hours
      checks: {
        database: "ok" as const,
        storage: "ok" as const,
        email: "ok" as const,
      },
    };

    const adminStats = {
      users: { active: 10, total: 20 },
      files: { total: 100 },
      shares: { active: 15, expired: 3 },
      reverseShares: { active: 2 },
    };

    const adminEmailStats = {
      pending: 3,
      sentLast24h: 120,
      failed: 0,
      digestPending: 1,
      status: "ok" as const,
      smtpConfigured: true,
      lastError: null,
    };

    beforeEach(() => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: adminHealthData,
        healthLoading: false,
        healthError: false,
        diskSpace: {
          diskSizeGB: 500,
          diskUsedGB: 200,
          diskAvailableGB: 300,
          uploadAllowed: true,
          warningLevel: "none",
          percentage: 40,
        },
        adminStats,
        adminStatsLoading: false,
        adminStatsError: null,
        emailStats: adminEmailStats,
        emailStatsLoading: false,
        emailStatsError: null,
      };
    });

    it("renders admin view when isAdmin is true", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // Admin view shows database check label
      expect(screen.getByText("checks.database")).toBeInTheDocument();
    });

    it("shows health checks section with database status", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("checks.database")).toBeInTheDocument();
    });

    it("shows health checks section with storage status", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("checks.storage")).toBeInTheDocument();
    });

    it("shows uptime", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // uptime: 7200s = 2h
      expect(screen.getByText("2h")).toBeInTheDocument();
    });

    it("shows platform metrics: users", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // users: active/total = "10/20"
      expect(screen.getByText("10/20")).toBeInTheDocument();
    });

    it("shows platform metrics: total files", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("100")).toBeInTheDocument();
    });

    it("shows platform metrics: active shares", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("15")).toBeInTheDocument();
    });

    it("shows platform metric labels", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("metrics.users")).toBeInTheDocument();
      expect(screen.getByText("metrics.files")).toBeInTheDocument();
      expect(screen.getByText("metrics.shares")).toBeInTheDocument();
    });

    it("shows disk space progress bar in admin view", () => {
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("progressbar", { name: "diskSpace.ariaLabel" })).toBeInTheDocument();
    });

    it("shows disk space error text when diskSpaceError is set", () => {
      currentMockStatus = {
        ...currentMockStatus,
        diskSpaceError: "server_error",
        diskSpace: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("errors.diskSpaceError")).toBeInTheDocument();
    });

    it("shows admin stats error text when adminStatsError is set", () => {
      currentMockStatus = {
        ...currentMockStatus,
        adminStatsError: "server_error",
        adminStats: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("errors.statsError")).toBeInTheDocument();
    });

    it("uses degraded status when health data has non-healthy status but db is ok", () => {
      currentMockStatus = {
        ...currentMockStatus,
        healthData: {
          status: "degraded" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 3600,
          checks: { database: "ok" as const, storage: "error" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.degraded")).toBeInTheDocument();
    });
  });

  // ── Email / Notifications subsystem (TD-42) ──────────────────────────────

  describe("email subsystem — user view", () => {
    it("does NOT show a notifications line when email is ok", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "ok" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.queryByText("email.userDisrupted")).not.toBeInTheDocument();
      expect(screen.queryByText("email.userOffline")).not.toBeInTheDocument();
    });

    it("does NOT show a notifications line when email is disabled", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "disabled" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.queryByText("email.userDisrupted")).not.toBeInTheDocument();
      expect(screen.queryByText("email.userOffline")).not.toBeInTheDocument();
    });

    it("shows 'disrupted' line when email is degraded", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "degraded" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.userDisrupted")).toBeInTheDocument();
      expect(screen.queryByText("email.userOffline")).not.toBeInTheDocument();
    });

    it("shows 'offline' line when email is down", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.userOffline")).toBeInTheDocument();
      expect(screen.queryByText("email.userDisrupted")).not.toBeInTheDocument();
    });

    it("renders the notifications line even when the user has no quota or metrics", () => {
      vi.mocked(useDashboardMetrics).mockReturnValue({
        fileCount: undefined,
        activeShareCount: undefined,
      });
      currentMockStatus = {
        ...mockStatus,
        diskSpace: null,
        healthStatus: { status: "healthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.userOffline")).toBeInTheDocument();
      // Restore the default so later tests still see metrics
      vi.mocked(useDashboardMetrics).mockReturnValue({ fileCount: 42, activeShareCount: 5 });
    });
  });

  describe("email subsystem — admin view", () => {
    const baseAdmin: UseSystemStatusResult = {
      ...mockStatus,
      isAdmin: true,
      healthData: {
        status: "healthy" as const,
        timestamp: "2026-05-23T00:00:00.000Z",
        uptime: 7200,
        checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
      },
      diskSpace: {
        diskSizeGB: 500,
        diskUsedGB: 200,
        diskAvailableGB: 300,
        uploadAllowed: true,
        warningLevel: "none",
        percentage: 40,
      },
      adminStats: {
        users: { active: 10, total: 20 },
        files: { total: 100 },
        shares: { active: 15, expired: 3 },
        reverseShares: { active: 2 },
      },
    };

    it("renders the email section label, status and counters", () => {
      currentMockStatus = {
        ...baseAdmin,
        emailStats: {
          pending: 7,
          sentLast24h: 120,
          failed: 2,
          digestPending: 1,
          status: "degraded" as const,
          smtpConfigured: true,
          lastError: null,
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.label")).toBeInTheDocument();
      expect(screen.getByText("email.status.degraded")).toBeInTheDocument();
      expect(screen.getByText("email.queue.pending")).toBeInTheDocument();
      expect(screen.getByText("email.queue.failed")).toBeInTheDocument();
      expect(screen.getByText("email.queue.sent24h")).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("120")).toBeInTheDocument();
    });

    it("hides the queue counters when SMTP is disabled", () => {
      currentMockStatus = {
        ...baseAdmin,
        emailStats: {
          pending: 0,
          sentLast24h: 0,
          failed: 0,
          digestPending: 0,
          status: "disabled" as const,
          smtpConfigured: false,
          lastError: null,
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.status.disabled")).toBeInTheDocument();
      expect(screen.queryByText("email.queue.pending")).not.toBeInTheDocument();
    });

    it("shows the last error line when emailStats.lastError is set", () => {
      currentMockStatus = {
        ...baseAdmin,
        emailStats: {
          pending: 1,
          sentLast24h: 0,
          failed: 5,
          digestPending: 0,
          status: "down" as const,
          smtpConfigured: true,
          lastError: "SMTP connection refused",
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("email.lastError:")).toBeInTheDocument();
      expect(screen.getByText("SMTP connection refused")).toBeInTheDocument();
    });

    it("shows the email stats error text when emailStatsError is set", () => {
      currentMockStatus = {
        ...baseAdmin,
        emailStats: null,
        emailStatsError: "server_error",
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("errors.emailStatsError")).toBeInTheDocument();
    });
  });

  describe("email subsystem — overall dot bump", () => {
    it("bumps a healthy admin dot to degraded when email is degraded", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 7200,
          checks: {
            database: "ok" as const,
            storage: "ok" as const,
            email: "degraded" as const,
          },
        },
        emailStats: {
          pending: 1,
          sentLast24h: 10,
          failed: 1,
          digestPending: 0,
          status: "degraded" as const,
          smtpConfigured: true,
          lastError: null,
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.degraded")).toBeInTheDocument();
      expect(screen.queryByText("status.healthy")).not.toBeInTheDocument();
    });

    it("bumps a healthy user dot to degraded when email is down", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.degraded")).toBeInTheDocument();
    });

    it("never bumps beyond degraded (email down with healthy core stays degraded)", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.queryByText("status.unhealthy")).not.toBeInTheDocument();
    });

    it("does not bump when email is ok", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "healthy" as const, email: "ok" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.healthy")).toBeInTheDocument();
    });

    it("does not bump (or render a status badge) while still loading", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusLoading: true,
        healthStatus: { status: "healthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // Loading suppresses the dot bump — no status badge is rendered at all.
      expect(screen.queryByText("status.degraded")).not.toBeInTheDocument();
      expect(screen.queryByText("status.healthy")).not.toBeInTheDocument();
    });

    it("does not downgrade an unhealthy core when email is down (bump only lifts healthy)", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatus: { status: "unhealthy" as const, email: "down" as const },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.unhealthy")).toBeInTheDocument();
      expect(screen.queryByText("status.degraded")).not.toBeInTheDocument();
    });
  });

  // ── Loading state ────────────────────────────────────────────────────────

  describe("loading state", () => {
    it("shows collapsed tab (not expanded) when loading", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusLoading: true,
      };
      render(<SystemStatusBar />);
      // Should still show collapsed tab button
      expect(screen.getByRole("button", { name: "expand" })).toBeInTheDocument();
    });

    it("shows loading skeletons when expanded during loading", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusLoading: true,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // No status badge when loading
      expect(screen.queryByText("status.healthy")).not.toBeInTheDocument();
      // The loading skeleton divs are rendered (animate-pulse divs)
      // We can verify the progress bar and content are NOT shown
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("shows loading skeletons for admin when all admin queries are loading", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthLoading: true,
        diskSpaceLoading: true,
        adminStatsLoading: true,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      // No status badge when loading
      expect(screen.queryByText("status.healthy")).not.toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  describe("error state", () => {
    it("shows error display when expanded with healthStatusError", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusError: "fetch_error",
        healthStatus: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByTestId("error-display")).toBeInTheDocument();
    });

    it("shows error display when expanded with admin healthError", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthError: true,
        healthData: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByTestId("error-display")).toBeInTheDocument();
    });

    it("error display contains errors.title text", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusError: "fetch_error",
        healthStatus: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      const errorDisplay = screen.getByTestId("error-display");
      expect(errorDisplay.textContent).toContain("errors.title");
    });

    it("does not show content section when there is an error", () => {
      currentMockStatus = {
        ...mockStatus,
        healthStatusError: "fetch_error",
        healthStatus: null,
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText("metrics.myFiles")).not.toBeInTheDocument();
    });
  });

  // ── formatUptime helper (tested indirectly through admin view) ───────────

  describe("uptime formatting via admin view", () => {
    it("formats uptime showing only minutes when less than an hour", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 1800, // 30 minutes
          checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("30m")).toBeInTheDocument();
    });

    it("formats uptime showing days, hours and minutes", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 90060, // 1d 1h 1m
          checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("1d 1h 1m")).toBeInTheDocument();
    });

    it("formats uptime showing 0m when exactly 0 seconds", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 0,
          checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("0m")).toBeInTheDocument();
    });

    it("formats uptime showing 0m when less than 60 seconds", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 59,
          checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("0m")).toBeInTheDocument();
    });

    it("formats uptime showing 1m when exactly 60 seconds", () => {
      currentMockStatus = {
        ...mockStatus,
        isAdmin: true,
        healthData: {
          status: "healthy" as const,
          timestamp: "2026-05-23T00:00:00.000Z",
          uptime: 60,
          checks: { database: "ok" as const, storage: "ok" as const, email: "ok" as const },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("1m")).toBeInTheDocument();
    });
  });
});
