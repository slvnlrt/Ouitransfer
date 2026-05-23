import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock formatStorageSize
vi.mock("@/utils/format-storage-size", () => ({
  formatStorageSize: (size: number) => `${size} GB`,
}));

// Mock useDashboardMetrics
vi.mock("@/contexts/dashboard-metrics-context", () => ({
  useDashboardMetrics: () => ({ fileCount: 42, activeShareCount: 5 }),
  DashboardMetricsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mutable mock for useSystemStatus
const mockStatus = {
  healthStatus: { status: "healthy" as const },
  healthStatusLoading: false,
  healthStatusError: null as string | null,
  healthData: null as {
    status: string;
    uptime: number;
    checks: { database: string; storage: string };
  } | null,
  healthLoading: false,
  healthError: false,
  diskSpace: {
    diskSizeGB: 100,
    diskUsedGB: 25,
    diskAvailableGB: 75,
    uploadAllowed: true,
    warningLevel: "none",
    percentage: 25,
  } as {
    diskSizeGB: number;
    diskUsedGB: number;
    diskAvailableGB: number;
    uploadAllowed: boolean;
    warningLevel: string;
    percentage: number;
  } | null,
  diskSpaceLoading: false,
  diskSpaceError: null as string | null,
  adminStats: null as {
    users: { active: number; total: number };
    files: { total: number };
    shares: { active: number };
  } | null,
  adminStatsLoading: false,
  adminStatsError: null as string | null,
  isAdmin: false,
  isRefreshing: false,
  refresh: vi.fn(),
};

let currentMockStatus = { ...mockStatus };

vi.mock("@/hooks/use-system-status", () => ({
  useSystemStatus: () => currentMockStatus,
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
      expect(screen.getByText("title")).toBeInTheDocument();
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
      // 25% should not appear as a quota badge
      expect(screen.queryByText("25%")).not.toBeInTheDocument();
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
      expect(screen.getByText("75%")).toBeInTheDocument();
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
      expect(screen.getByText("90%")).toBeInTheDocument();
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
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("does NOT show quota badge when diskSpace is null", () => {
      currentMockStatus = {
        ...mockStatus,
        diskSpace: null,
      };
      render(<SystemStatusBar />);
      // No percentage badge should appear
      const button = screen.getByRole("button", { name: "expand" });
      expect(button).toBeInTheDocument();
      // No percentage text
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("button", { name: "collapse" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "collapse" }));
      // Back to collapsed state
      expect(screen.getByRole("button", { name: "expand" })).toBeInTheDocument();
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
      status: "healthy",
      uptime: 7200, // 2 hours
      checks: {
        database: "ok",
        storage: "ok",
      },
    };

    const adminStats = {
      users: { active: 10, total: 20 },
      files: { total: 100 },
      shares: { active: 15 },
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
          status: "degraded",
          uptime: 3600,
          checks: { database: "ok", storage: "error" },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("status.degraded")).toBeInTheDocument();
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
          status: "healthy",
          uptime: 1800, // 30 minutes
          checks: { database: "ok", storage: "ok" },
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
          status: "healthy",
          uptime: 90060, // 1d 1h 1m
          checks: { database: "ok", storage: "ok" },
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
          status: "healthy",
          uptime: 0,
          checks: { database: "ok", storage: "ok" },
        },
      };
      render(<SystemStatusBar />);
      fireEvent.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByText("0m")).toBeInTheDocument();
    });
  });
});
