/**
 * Tests for audit page components:
 *   - AuditLogTable: empty state, log entry rendering
 *   - AuditLogExport: disabled/enabled state based on date range
 *   - AuditMetadataDisplay: byte formatting for quota changes, generic key-value, null handling
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (must be hoisted before component imports) ──────────────────────────

// next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

// lucide-react icons — minimal stubs so jsdom doesn't choke on SVG
vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Download: () => <span data-testid="icon-download" />,
}));

// shadcn/ui — Badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant, ...props }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant} {...props}>
      {children}
    </span>
  ),
}));

// shadcn/ui — Table components
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => <tr {...props}>{children}</tr>,
  TableHead: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableCell: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    colSpan?: number;
    className?: string;
  }) => <td {...props}>{children}</td>,
}));

// shadcn/ui — Button
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    variant,
    size,
    ...props
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    variant?: string;
    size?: string;
  }) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// shadcn/ui — Skeleton
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// shadcn/ui — DropdownMenu
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div data-testid="dropdown-trigger">{children}</div>,
  DropdownMenuContent: ({
    children,
    align: _align,
  }: {
    children: React.ReactNode;
    align?: string;
  }) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// HTTP endpoint — exportAuditLogs returns a URL string (no network needed)
vi.mock("@/http/endpoints/audit", () => ({
  exportAuditLogs: vi.fn(
    ({ format, dateFrom, dateTo }: { format: string; dateFrom: string; dateTo: string }) =>
      `/api/admin/audit-logs/export?format=${format}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
  ),
}));

// ── Component imports (after mocks) ──────────────────────────────────────────

import type { AuditLogEntry } from "@/http/endpoints/audit/types";
import { AuditLogExport } from "../components/audit-log-export";
import { AuditLogTable } from "../components/audit-log-table";
import { AuditMetadataDisplay } from "../components/audit-metadata-display";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_LOG: AuditLogEntry = {
  id: "log-1",
  userId: "user-abc123",
  action: "LOGIN_SUCCESS",
  ipAddress: "127.0.0.1",
  userAgent: "Mozilla/5.0",
  metadata: null,
  targetType: null,
  targetId: null,
  createdAt: "2026-05-23T10:00:00.000Z",
};

const DEFAULT_TABLE_PROPS = {
  logs: [],
  total: 0,
  isLoading: false,
  currentPage: 0,
  totalPages: 1,
  onPageChange: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AuditLogTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no logs", () => {
    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[]} />);
    expect(screen.getByText("table.noResults")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} />);
    expect(screen.getByText("table.date")).toBeInTheDocument();
    expect(screen.getByText("table.user")).toBeInTheDocument();
    expect(screen.getByText("table.action")).toBeInTheDocument();
    expect(screen.getByText("table.target")).toBeInTheDocument();
    expect(screen.getByText("table.ipAddress")).toBeInTheDocument();
    expect(screen.getByText("table.details")).toBeInTheDocument();
  });

  it("renders log entries with action badge", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      action: "LOGIN_SUCCESS",
      userId: "user-abc123",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    // Action rendered as a colored span — safeTranslate tries "actions.LOGIN_SUCCESS" key
    expect(screen.getByText("actions.LOGIN_SUCCESS")).toBeInTheDocument();
  });

  it("renders abbreviated user ID for authenticated user", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      userId: "user-abc123def456",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    // Shows first 8 chars of userId followed by ellipsis
    expect(screen.getByText("user-abc…")).toBeInTheDocument();
  });

  it("renders anonymous badge when userId is null and action is not system", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      userId: null,
      action: "LOGIN_FAILURE",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    // "table.anonymous" badge shown for anonymous users
    const badges = screen.getAllByTestId("badge");
    const anonymousBadge = badges.find((b) => b.textContent === "table.anonymous");
    expect(anonymousBadge).toBeInTheDocument();
  });

  it("renders system badge for AUDIT_RETENTION_CLEANUP action", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      userId: null,
      action: "AUDIT_RETENTION_CLEANUP",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    const badges = screen.getAllByTestId("badge");
    const systemBadge = badges.find((b) => b.textContent === "table.system");
    expect(systemBadge).toBeInTheDocument();
  });

  it("renders IP address in table cell", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      ipAddress: "192.168.1.1",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
  });

  it("renders target type and abbreviated target ID when present", () => {
    const log: AuditLogEntry = {
      ...BASE_LOG,
      targetType: "user",
      targetId: "target-abcdef12",
    };

    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} logs={[log]} total={1} />);

    // Target type is translated via safeTranslate: "targetTypes.user"
    expect(screen.getByText("targetTypes.user")).toBeInTheDocument();
    // Target ID is first 8 chars + ellipsis
    expect(screen.getByText("target-a…")).toBeInTheDocument();
  });

  it("renders loading skeletons when isLoading is true", () => {
    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} isLoading={true} />);
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("does not render empty state when loading", () => {
    render(<AuditLogTable {...DEFAULT_TABLE_PROPS} isLoading={true} />);
    expect(screen.queryByText("table.noResults")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("AuditLogExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables export button when no date range is set", () => {
    render(<AuditLogExport params={{}} />);
    // The trigger button contains the i18n key "export.button"
    const button = screen.getByRole("button", { name: /export\.button/i });
    expect(button).toBeDisabled();
  });

  it("disables export button when only dateFrom is set", () => {
    render(<AuditLogExport params={{ dateFrom: "2026-05-01" }} />);
    const button = screen.getByRole("button", { name: /export\.button/i });
    expect(button).toBeDisabled();
  });

  it("disables export button when only dateTo is set", () => {
    render(<AuditLogExport params={{ dateTo: "2026-05-31" }} />);
    const button = screen.getByRole("button", { name: /export\.button/i });
    expect(button).toBeDisabled();
  });

  it("enables export button when both dateFrom and dateTo are set", () => {
    render(<AuditLogExport params={{ dateFrom: "2026-05-01", dateTo: "2026-05-31" }} />);
    const button = screen.getByRole("button", { name: /export\.button/i });
    expect(button).not.toBeDisabled();
  });

  it("renders export button with i18n label", () => {
    render(<AuditLogExport params={{}} />);
    expect(screen.getByRole("button", { name: /export\.button/i })).toHaveTextContent(
      "export.button",
    );
  });

  it("shows dateRangeRequired message when no date range", () => {
    render(<AuditLogExport params={{}} />);
    expect(screen.getByText("export.dateRangeRequired")).toBeInTheDocument();
  });

  it("shows CSV and JSON options when date range is set", () => {
    render(<AuditLogExport params={{ dateFrom: "2026-05-01", dateTo: "2026-05-31" }} />);
    expect(screen.getByText("export.csv")).toBeInTheDocument();
    expect(screen.getByText("export.json")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("AuditMetadataDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when metadata is null", () => {
    const { container } = render(<AuditMetadataDisplay action="LOGIN_SUCCESS" metadata={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when metadata is an empty object", () => {
    const { container } = render(<AuditMetadataDisplay action="LOGIN_SUCCESS" metadata={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("formats bytes correctly for USER_QUOTA_CHANGE — 1 GB → 2 GB (maxFileSize)", () => {
    // 1073741824 bytes = 1.0 GB
    // 2147483648 bytes = 2.0 GB
    render(
      <AuditMetadataDisplay
        action="USER_QUOTA_CHANGE"
        metadata={{ oldMaxFileSize: 1073741824, newMaxFileSize: 2147483648 }}
      />,
    );

    // Should render "1.0 GB → 2.0 GB"
    expect(screen.getByText(/1\.0 GB/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 GB/)).toBeInTheDocument();
  });

  it("formats bytes correctly for USER_QUOTA_CHANGE — bytes to KB (maxTotalStorage)", () => {
    // 512 bytes stays as "512 B" (< 1024)
    // 1536 bytes = 1.5 KB
    render(
      <AuditMetadataDisplay
        action="USER_QUOTA_CHANGE"
        metadata={{ oldMaxTotalStorage: 512, newMaxTotalStorage: 1536 }}
      />,
    );

    expect(screen.getByText(/512 B/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 KB/)).toBeInTheDocument();
  });

  it("renders generic key-value metadata for non-quota actions", () => {
    render(
      <AuditMetadataDisplay
        action="SHARE_CREATE"
        metadata={{ shareName: "My Share", isPublic: true }}
      />,
    );

    // Values should be rendered
    expect(screen.getByText("My Share")).toBeInTheDocument();
    // Boolean true renders as t("metadata.yes") which the mock returns as "yes"
    expect(screen.getByText("yes")).toBeInTheDocument();
  });

  it("renders boolean false as i18n 'no' key in generic metadata", () => {
    render(<AuditMetadataDisplay action="SHARE_UPDATE" metadata={{ passwordProtected: false }} />);

    // Boolean false renders as t("metadata.no") which the mock returns as "no"
    expect(screen.getByText("no")).toBeInTheDocument();
  });

  it("renders array values with Intl.ListFormat in generic metadata", () => {
    render(
      <AuditMetadataDisplay
        action="GROUP_MEMBER_ADD"
        metadata={{ members: ["alice", "bob", "carol"] }}
      />,
    );

    // Intl.ListFormat with en-US locale produces "alice, bob, and carol"
    expect(screen.getByText("alice, bob, and carol")).toBeInTheDocument();
  });

  it("renders null value as em-dash in generic metadata", () => {
    render(<AuditMetadataDisplay action="FILE_MOVE" metadata={{ previousFolder: null }} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not render quota format for USER_QUOTA_CHANGE when byte keys are missing", () => {
    // Falls through to generic rendering when oldMaxFileSize/newMaxFileSize/etc. are absent
    render(
      <AuditMetadataDisplay action="USER_QUOTA_CHANGE" metadata={{ reason: "admin override" }} />,
    );

    // Generic rendering: "reason" key with value "admin override"
    expect(screen.getByText("admin override")).toBeInTheDocument();
  });
});
