/**
 * Tests for the ErrorDisplay component.
 *
 * Covers:
 *   - All three variants: page (default), inline, minimal
 *   - Default and custom icon rendering
 *   - Action buttons (onClick) and action links (href → <a> tag)
 *   - Conditional rendering of message and actions sections
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorDisplay } from "@/components/error-display";

// next/link requires a router context that does not exist in jsdom.
// Mock it to a simple <a> passthrough so we can test href rendering without
// pulling in the full Next.js runtime.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ── Variant rendering ─────────────────────────────────────────────────────────

describe("ErrorDisplay — variants", () => {
  it("renders title and message for the default (page) variant", () => {
    render(<ErrorDisplay title="Something went wrong" message="Please try again later." />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Please try again later.")).toBeInTheDocument();
  });

  it("renders title and message for the inline variant", () => {
    render(
      <ErrorDisplay variant="inline" title="Inline error" message="An inline error occurred." />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Inline error" })).toBeInTheDocument();
    expect(screen.getByText("An inline error occurred.")).toBeInTheDocument();
  });

  it("renders title and message for the minimal variant", () => {
    render(
      <ErrorDisplay variant="minimal" title="Minimal error" message="Minimal error message." />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Minimal error" })).toBeInTheDocument();
    expect(screen.getByText("Minimal error message.")).toBeInTheDocument();
  });

  it("page variant wraps content in a div with min-h-[60vh]", () => {
    const { container } = render(<ErrorDisplay title="Page error" />);
    // The outer wrapper should contain the min-h class that centres content vertically
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toMatch(/min-h-\[60vh\]/);
  });

  it("inline variant renders a Card element (data-slot='card')", () => {
    const { container } = render(<ErrorDisplay variant="inline" title="Inline error" />);
    const card = container.querySelector("[data-slot='card']");
    expect(card).toBeInTheDocument();
  });

  it("minimal variant does not render a Card", () => {
    const { container } = render(<ErrorDisplay variant="minimal" title="Minimal error" />);
    const card = container.querySelector("[data-slot='card']");
    expect(card).not.toBeInTheDocument();
  });
});

// ── Icon rendering ────────────────────────────────────────────────────────────

describe("ErrorDisplay — icon", () => {
  it("renders the default AlertCircle icon (svg) when no icon prop is given", () => {
    const { container } = render(<ErrorDisplay title="Error" />);
    // lucide-react renders SVG elements
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders a custom icon when provided via the icon prop", () => {
    const CustomIcon = () => <span data-testid="custom-icon">!</span>;
    render(<ErrorDisplay title="Error" icon={<CustomIcon />} />);

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("does not render the default AlertCircle svg when a custom icon is provided", () => {
    // If a custom icon is given the default SVG should be replaced, not duplicated.
    const CustomIcon = () => <span data-testid="custom-icon">X</span>;
    const { container } = render(<ErrorDisplay title="Error" icon={<CustomIcon />} />);

    // Custom icon is present
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    // No SVG from lucide (the default icon) should remain
    const svg = container.querySelector("svg");
    expect(svg).not.toBeInTheDocument();
  });
});

// ── Actions ───────────────────────────────────────────────────────────────────

describe("ErrorDisplay — actions", () => {
  it("renders an action button that calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<ErrorDisplay title="Error" actions={[{ label: "Retry", onClick: handleClick }]} />);

    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it("renders multiple action buttons", () => {
    const handlers = [vi.fn(), vi.fn()];

    render(
      <ErrorDisplay
        title="Error"
        actions={[
          { label: "Cancel", onClick: handlers[0] },
          { label: "Retry", onClick: handlers[1] },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders an action link as <a> with the correct href", () => {
    render(<ErrorDisplay title="Error" actions={[{ label: "Go home", href: "/" }]} />);

    const link = screen.getByRole("link", { name: "Go home" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders an action link to an absolute URL", () => {
    render(
      <ErrorDisplay title="Error" actions={[{ label: "Contact support", href: "/support" }]} />,
    );

    const link = screen.getByRole("link", { name: "Contact support" });
    expect(link).toHaveAttribute("href", "/support");
  });

  it("renders a mix of link and button actions", () => {
    const handleClick = vi.fn();

    render(
      <ErrorDisplay
        title="Error"
        actions={[
          { label: "Go home", href: "/" },
          { label: "Try again", onClick: handleClick },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Go home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

// ── Conditional rendering ─────────────────────────────────────────────────────

describe("ErrorDisplay — conditional rendering", () => {
  it("does not render message text when message prop is undefined", () => {
    render(<ErrorDisplay title="Error without message" />);

    // Title is present
    expect(screen.getByRole("heading", { name: "Error without message" })).toBeInTheDocument();
    // No <p> message element
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });

  it("does not render actions section when actions prop is undefined", () => {
    render(<ErrorDisplay title="Error" />);
    // No buttons or links rendered
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render actions section when actions is an empty array", () => {
    render(<ErrorDisplay title="Error" actions={[]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
