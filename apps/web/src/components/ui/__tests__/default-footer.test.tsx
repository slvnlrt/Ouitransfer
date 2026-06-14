/**
 * @vitest-environment jsdom
 *
 * Tests that the admin-configurable footer link (A7-01) is rendered safely:
 *   - non-http(s) hrefs (javascript:/data:/protocol-relative) fall back to "#"
 *   - the link always carries rel="noopener noreferrer" + target="_blank"
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the secure-config hook with a per-key value map.
let configMap: Record<string, string | null> = {};
vi.mock("@/hooks/use-secure-configs", () => ({
  useSecureConfigValue: (key: string) => ({
    value: configMap[key] ?? null,
    isLoading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// next/link → plain anchor passing through href/target/rel.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    target,
    rel,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    target?: string;
    rel?: string;
    className?: string;
  }) =>
    React.createElement("a", { href, target, rel, className, "data-testid": "footer-link" }, children),
}));

// Tooltip primitives → pass-through wrappers.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
}));

import { DefaultFooter } from "../default-footer";

function setConfig(map: Record<string, string | null>) {
  configMap = { footerEnabled: "true", footerText: "My Company", ...map };
}

describe("DefaultFooter footer URL safety (A7-01)", () => {
  afterEach(() => {
    configMap = {};
    vi.clearAllMocks();
  });

  it("renders a valid https URL as the href with rel=noopener noreferrer", () => {
    setConfig({ footerUrl: "https://example.com" });
    render(<DefaultFooter />);
    const link = screen.getByTestId("footer-link");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("falls back to '#' for a javascript: URL", () => {
    setConfig({ footerUrl: "javascript:alert(1)" });
    render(<DefaultFooter />);
    expect(screen.getByTestId("footer-link")).toHaveAttribute("href", "#");
  });

  it("falls back to '#' for a data: URL", () => {
    setConfig({ footerUrl: "data:text/html,<script>alert(1)</script>" });
    render(<DefaultFooter />);
    expect(screen.getByTestId("footer-link")).toHaveAttribute("href", "#");
  });

  it("falls back to '#' for a protocol-relative URL", () => {
    setConfig({ footerUrl: "//evil.com" });
    render(<DefaultFooter />);
    expect(screen.getByTestId("footer-link")).toHaveAttribute("href", "#");
  });

  it("falls back to '#' when no footerUrl is set", () => {
    setConfig({ footerUrl: null });
    render(<DefaultFooter />);
    expect(screen.getByTestId("footer-link")).toHaveAttribute("href", "#");
  });
});
